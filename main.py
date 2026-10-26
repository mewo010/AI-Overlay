"""
GeminiOverlay - Production System-Wide Floating AI Assistant for Windows
========================================================================
Architecture:
- Bottom-Middle Floating Overlay: Sleek borderless mobile-style assistant dock anchored
  at the bottom-center of the screen. Smoothly expands upwards when answering.
- Semi-Transparent Glassmorphism: Shifts to subtle translucent glassmorphic look
  (rgba(13, 16, 23, 0.72)) during active response/streaming so underlying windows are visible.
- Independent Hotkeys & Windows: Dedicated hotkey for Chat (Ctrl+Shift+Space),
  dedicated hotkey for Settings (Ctrl+Shift+,), and Push-to-Talk Voice (Ctrl+Shift+V).
- Persistent Memory System: Contextual memory store (memories.json) that remembers user rules/preferences
  (e.g., "always address me as king") across sessions and injects them into system instructions.
- Memory Manager UI: Dedicated panel inside Settings to inspect, add, and delete memories.
- Audio Device Routing: Automatic discovery of microphones and headphones/speakers via sounddevice,
  with independent selection and direct routing of both Gemini Live voice and TTS audio playback.
- Clean Minimalist Charcoal Aesthetic: Replaces purple dominance with deep dark neutral tones,
  crisp borders, and restrained ice-blue/cyan accents.
- Windows Native Integration: Windows DPAPI encryption at rest, HKCU Run startup registry,
  and win32 foreground focus enforcement.
- Model Support: Strictly valid free-tier models (gemini-3.8-flash default, gemini-3.5-flash-lite fallback).
"""

import sys
import os
import json
import base64
import time
import asyncio
import threading
import queue
import traceback
import uuid
from datetime import datetime
from typing import Optional, Dict, Any, List

# Windows-specific native libraries
import winreg
try:
    import win32gui
    import win32con
    import win32process
    import win32crypt
except ImportError:
    win32gui = None
    win32con = None
    win32process = None
    win32crypt = None

# Audio & Media processing
import sounddevice as sd
import numpy as np
from PIL import ImageGrab, Image

# Global Hotkeys
from pynput import keyboard as pynput_kb

# Official Google GenAI SDK
from google import genai
from google.genai import types

# PyQt6 GUI framework
from PyQt6.QtCore import (
    Qt, QThread, pyqtSignal, pyqtSlot, QPoint, QRect, QSize,
    QLockFile, QDir, QTimer, QObject, QEvent, QPropertyAnimation,
    QEasingCurve, QParallelAnimationGroup
)
from PyQt6.QtGui import (
    QIcon, QPixmap, QPainter, QColor, QRadialGradient, QLinearGradient,
    QBrush, QPen, QFont, QKeySequence, QGuiApplication, QAction, QCursor,
    QPainterPath
)
from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QStackedLayout, QTextBrowser, QPlainTextEdit, QPushButton, QLabel,
    QLineEdit, QComboBox, QCheckBox, QKeySequenceEdit, QSystemTrayIcon,
    QMenu, QSizeGrip, QGraphicsDropShadowEffect, QFrame, QProgressBar,
    QMessageBox, QDialog, QScrollArea, QTabWidget
)


# ==============================================================================
# 1. ICON GENERATOR & CLEAN MINIMALIST ASSETS
# ==============================================================================

def create_gemini_icon(size: int = 64) -> QIcon:
    """
    Generates a crisp, high-DPI modern icon with subtle dark neutral glow
    and ice-blue / cyan diamond star sparkle.
    """
    pixmap = QPixmap(size, size)
    pixmap.fill(Qt.GlobalColor.transparent)

    painter = QPainter(pixmap)
    painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)

    # Ambient subtle circular base
    radial = QRadialGradient(size / 2, size / 2, size / 2)
    radial.setColorAt(0.0, QColor(30, 41, 59, 240))      # Slate 800
    radial.setColorAt(0.7, QColor(15, 23, 42, 220))      # Slate 900
    radial.setColorAt(1.0, QColor(15, 23, 42, 0))        # Transparent edge
    painter.setBrush(QBrush(radial))
    painter.setPen(Qt.PenStyle.NoPen)
    painter.drawEllipse(2, 2, size - 4, size - 4)

    # Inner Gemini sparkle diamond
    painter.setPen(QPen(QColor(56, 189, 248, 240), 2.0))   # Sky blue
    painter.setBrush(QBrush(QColor(241, 245, 249, 230)))   # Off-white

    cx, cy = size / 2, size / 2
    r_outer = size * 0.32

    # 4-point star path
    path = QPainterPath()
    path.moveTo(cx, cy - r_outer)
    path.quadTo(cx, cy, cx + r_outer, cy)
    path.quadTo(cx, cy, cx, cy + r_outer)
    path.quadTo(cx, cy, cx - r_outer, cy)
    path.quadTo(cx, cy, cx, cy - r_outer)
    path.closeSubpath()
    painter.drawPath(path)

    # Core bright dot
    painter.setBrush(QBrush(QColor(255, 255, 255, 255)))
    painter.drawEllipse(int(cx - 2), int(cy - 2), 4, 4)

    painter.end()
    return QIcon(pixmap)


# ==============================================================================
# 2. PERSISTENT MEMORY MANAGER (LOCAL JSON STORE)
# ==============================================================================

class MemoryManager:
    """
    Manages persistent user memories, preferences, and system instructions
    saved in %APPDATA%\\GeminiOverlay\\memories.json.
    Automatically formatted into system_instruction for Gemini queries.
    """

    def __init__(self, storage_dir: Optional[str] = None):
        if not storage_dir:
            appdata_dir = os.environ.get("APPDATA", os.path.expanduser("~"))
            self.storage_dir = os.path.join(appdata_dir, "GeminiOverlay")
        else:
            self.storage_dir = storage_dir

        os.makedirs(self.storage_dir, exist_ok=True)
        self.memory_file = os.path.join(self.storage_dir, "memories.json")
        self.memories: List[Dict[str, Any]] = []
        self.load()

    def load(self):
        """Loads saved memories from disk or initializes defaults."""
        if os.path.exists(self.memory_file):
            try:
                with open(self.memory_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, list):
                        self.memories = data
            except Exception as e:
                print(f"[Memory] Failed to load memories: {e}")
                self.memories = []
        else:
            # Starter sample memory demonstrating the feature
            self.memories = [
                {
                    "id": "mem_default_1",
                    "text": "Address the user politely, concisely, and with direct answers.",
                    "created_at": datetime.now().strftime("%Y-%m-%d %H:%M")
                }
            ]
            self.save()

    def save(self):
        """Persists memories to disk."""
        try:
            with open(self.memory_file, "w", encoding="utf-8") as f:
                json.dump(self.memories, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"[Memory] Failed to save memories: {e}")

    def add_memory(self, text: str) -> Optional[Dict[str, Any]]:
        """Adds a new memory item if non-empty and not duplicated."""
        cleaned = text.strip()
        if not cleaned:
            return None

        # Check for duplicates
        for m in self.memories:
            if m.get("text", "").lower() == cleaned.lower():
                return m

        new_entry = {
            "id": f"mem_{uuid.uuid4().hex[:8]}",
            "text": cleaned,
            "created_at": datetime.now().strftime("%Y-%m-%d %H:%M")
        }
        self.memories.append(new_entry)
        self.save()
        return new_entry

    def remove_memory(self, memory_id: str) -> bool:
        """Removes a specific memory item by id."""
        initial_len = len(self.memories)
        self.memories = [m for m in self.memories if m.get("id") != memory_id]
        if len(self.memories) != initial_len:
            self.save()
            return True
        return False

    def clear_all(self):
        """Removes all stored memories."""
        self.memories = []
        self.save()

    def get_all(self) -> List[Dict[str, Any]]:
        return list(self.memories)

    def get_system_context(self) -> str:
        """
        Formats active memories into a clean prompt context block
        injected into Gemini's system_instruction.
        """
        if not self.memories:
            return ""

        bullet_points = "\n".join(f"- {m.get('text', '')}" for m in self.memories if m.get("text"))
        return (
            "\n[ACTIVE USER SAVED MEMORIES & PREFERENCES]:\n"
            "The user has specified the following rules and preferences. You MUST follow them at all times:\n"
            f"{bullet_points}\n"
        )


# ==============================================================================
# 3. CONFIGURATION MANAGER (DPAPI ENCRYPTION & JSON PERSISTENCE)
# ==============================================================================

class ConfigManager:
    """
    Manages persistent configuration stored in %APPDATA%\\GeminiOverlay\\config.json.
    Secures API keys at rest using Windows DPAPI (CryptProtectData / CryptUnprotectData).
    Strictly filters out deprecated or non-existent models (e.g. gemini-2.5-flash).
    """

    DEFAULT_CONFIG = {
        "api_key_encrypted": "",
        "model": "gemini-3.8-flash",          # Flagship text/vision model
        "live_model": "gemini-3.8-flash",     # Live voice model
        "hotkey_toggle": "Ctrl+Shift+Space",  # Bottom overlay toggle
        "hotkey_settings": "Ctrl+Shift+,",    # Dedicated Settings toggle
        "hotkey_voice": "Ctrl+Shift+V",       # Push-to-talk voice
        "start_with_windows": False,
        "voice_name": "Puck",
        "input_device": None,                 # Microphone device index
        "output_device": None,                # Headphones/speaker device index
        "speak_typed_answers": True,          # Read answers aloud automatically via TTS
        "headphones_mode": False,
        "pin_active": False,
        "window_geometry": {
            "x": -1,
            "y": -1,
            "width": 640,
            "height": 110                     # Default compact height
        }
    }

    def __init__(self):
        appdata_dir = os.environ.get("APPDATA", os.path.expanduser("~"))
        self.config_dir = os.path.join(appdata_dir, "GeminiOverlay")
        os.makedirs(self.config_dir, exist_ok=True)
        self.config_file = os.path.join(self.config_dir, "config.json")
        self.data: Dict[str, Any] = {}
        self.load()

    def encrypt_secret(self, plaintext: str) -> str:
        """Encrypts sensitive text using Windows DPAPI (per-user key)."""
        if not plaintext:
            return ""
        if win32crypt is not None:
            try:
                raw_bytes = plaintext.encode("utf-8")
                encrypted_bytes = win32crypt.CryptProtectData(
                    raw_bytes, "GeminiOverlayKey", None, None, None, 0
                )
                return base64.b64encode(encrypted_bytes).decode("ascii")
            except Exception as e:
                print(f"[Config] DPAPI Encryption error: {e}")
        return base64.b64encode(plaintext.encode("utf-8")).decode("ascii")

    def decrypt_secret(self, encrypted_b64: str) -> str:
        """Decrypts Windows DPAPI ciphertext back to plaintext."""
        if not encrypted_b64:
            return ""
        if win32crypt is not None:
            try:
                cipher_bytes = base64.b64decode(encrypted_b64.encode("ascii"))
                _, decrypted_bytes = win32crypt.CryptUnprotectData(
                    cipher_bytes, None, None, None, 0
                )
                return decrypted_bytes.decode("utf-8")
            except Exception as e:
                print(f"[Config] DPAPI Decryption error: {e}")
                return ""
        try:
            return base64.b64decode(encrypted_b64.encode("ascii")).decode("utf-8")
        except Exception:
            return ""

    def load(self):
        """Loads configuration from JSON file or initializes defaults."""
        self.data = dict(self.DEFAULT_CONFIG)
        if os.path.exists(self.config_file):
            try:
                with open(self.config_file, "r", encoding="utf-8") as f:
                    saved = json.load(f)
                    self.data.update(saved)
            except Exception as e:
                print(f"[Config] Failed to load config, using defaults: {e}")

        # Strictly enforce valid free-tier models:
        # gemini-3.8-flash (default flagship)
        # gemini-3.5-flash-lite (lightweight fallback)
        # Purge deprecated gemini-2.5-flash which returns 404 NOT_FOUND
        valid_models = {"gemini-3.8-flash", "gemini-3.5-flash-lite"}
        migrated = False
        if self.data.get("model") not in valid_models:
            print(f"[Config] Migrating model from '{self.data.get('model')}' to 'gemini-3.8-flash'")
            self.data["model"] = "gemini-3.8-flash"
            migrated = True

        if self.data.get("live_model") not in valid_models:
            self.data["live_model"] = "gemini-3.8-flash"
            migrated = True

        if "hotkey_settings" not in self.data:
            self.data["hotkey_settings"] = "Ctrl+Shift+,"
            migrated = True

        if migrated:
            self.save()

    def save(self):
        """Persists current configuration to disk."""
        try:
            with open(self.config_file, "w", encoding="utf-8") as f:
                json.dump(self.data, f, indent=2)
        except Exception as e:
            print(f"[Config] Failed to save config: {e}")

    def get_api_key(self) -> str:
        """Retrieves DPAPI encrypted key, falling back to GEMINI_API_KEY env variable."""
        saved_key = self.decrypt_secret(self.data.get("api_key_encrypted", ""))
        if saved_key:
            return saved_key
        return os.environ.get("GEMINI_API_KEY", "").strip()

    def set_api_key(self, raw_key: str):
        self.data["api_key_encrypted"] = self.encrypt_secret(raw_key.strip())


# ==============================================================================
# 4. STARTUP MANAGER (WINDOWS REGISTRY INTEGRATION)
# ==============================================================================

class StartupManager:
    """
    Integrates with HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run.
    Supports both PyInstaller frozen binary execution and Python script execution.
    """
    REG_SUBKEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
    APP_NAME = "GeminiOverlay"

    @classmethod
    def get_launch_command(cls) -> str:
        """Determines the exact Windows execution command line."""
        if getattr(sys, "frozen", False):
            exe_path = sys.executable
            return f'"{exe_path}"'
        else:
            python_exe = sys.executable
            script_path = os.path.abspath(sys.argv[0])
            return f'"{python_exe}" "{script_path}"'

    @classmethod
    def is_enabled(cls) -> bool:
        try:
            with winreg.OpenKey(
                winreg.HKEY_CURRENT_USER, cls.REG_SUBKEY, 0, winreg.KEY_READ
            ) as key:
                value, _ = winreg.QueryValueEx(key, cls.APP_NAME)
                return bool(value)
        except FileNotFoundError:
            return False
        except Exception as e:
            print(f"[Startup] Error checking registry: {e}")
            return False

    @classmethod
    def set_enabled(cls, enable: bool) -> bool:
        try:
            with winreg.OpenKey(
                winreg.HKEY_CURRENT_USER, cls.REG_SUBKEY, 0, winreg.KEY_WRITE
            ) as key:
                if enable:
                    cmd = cls.get_launch_command()
                    winreg.SetValueEx(key, cls.APP_NAME, 0, winreg.REG_SZ, cmd)
                else:
                    try:
                        winreg.DeleteValue(key, cls.APP_NAME)
                    except FileNotFoundError:
                        pass
            return True
        except Exception as e:
            print(f"[Startup] Error modifying registry: {e}")
            return False


# ==============================================================================
# 5. WINDOWS FOREGROUND FOCUS HELPER
# ==============================================================================

def force_activate_window(hwnd: int):
    """
    Forces Windows to yield foreground focus to the overlay window even when
    invoked from a global hotkey or background thread.
    """
    if win32gui is None or not hwnd:
        return

    try:
        current_thread_id = win32process.GetCurrentThreadId()
        foreground_hwnd = win32gui.GetForegroundWindow()
        foreground_thread_id, _ = win32process.GetWindowThreadProcessId(foreground_hwnd)

        if foreground_thread_id != current_thread_id and foreground_thread_id != 0:
            win32process.AttachThreadInput(foreground_thread_id, current_thread_id, True)
            win32gui.ShowWindow(hwnd, win32con.SW_SHOW)
            win32gui.BringWindowToTop(hwnd)
            win32gui.SetForegroundWindow(hwnd)
            win32process.AttachThreadInput(foreground_thread_id, current_thread_id, False)
        else:
            win32gui.ShowWindow(hwnd, win32con.SW_SHOW)
            win32gui.BringWindowToTop(hwnd)
            win32gui.SetForegroundWindow(hwnd)
    except Exception as e:
        print(f"[Focus] Error forcing foreground focus: {e}")


# ==============================================================================
# 6. GLOBAL HOTKEY MANAGER (PYNPUT THREAD -> QT SIGNALS)
# ==============================================================================

def qt_keysequence_to_pynput(seq_str: str) -> Optional[str]:
    """Converts Qt QKeySequence string representations into valid pynput format."""
    if not seq_str:
        return None

    parts = [p.strip() for p in seq_str.split("+")]
    pynput_parts = []

    key_map = {
        "ctrl": "<ctrl>",
        "control": "<ctrl>",
        "shift": "<shift>",
        "alt": "<alt>",
        "meta": "<cmd>",
        "win": "<cmd>",
        "space": "<space>",
        "esc": "<esc>",
        "escape": "<esc>",
        "return": "<enter>",
        "enter": "<enter>",
        "tab": "<tab>",
        ",": ",",
    }

    for part in parts:
        low = part.lower()
        if low in key_map:
            pynput_parts.append(key_map[low])
        elif len(part) == 1:
            pynput_parts.append(part.lower())
        else:
            pynput_parts.append(f"<{low}>")

    return "+".join(pynput_parts)


class GlobalHotkeyManager(QObject):
    """
    Runs pynput.keyboard.GlobalHotKeys inside an independent thread and safely
    bridges independent hotkeys (Chat, Settings, Voice) into Qt signals.
    """
    toggle_requested = pyqtSignal()
    settings_requested = pyqtSignal()
    voice_requested = pyqtSignal()

    def __init__(self, toggle_seq: str, settings_seq: str, voice_seq: str):
        super().__init__()
        self.toggle_seq = toggle_seq
        self.settings_seq = settings_seq
        self.voice_seq = voice_seq
        self.listener: Optional[pynput_kb.GlobalHotKeys] = None
        self._lock = threading.Lock()
        self.start_listener()

    def _on_toggle(self):
        self.toggle_requested.emit()

    def _on_settings(self):
        self.settings_requested.emit()

    def _on_voice(self):
        self.voice_requested.emit()

    def start_listener(self):
        with self._lock:
            self.stop_listener()
            hotkey_mapping = {}

            p_toggle = qt_keysequence_to_pynput(self.toggle_seq)
            if p_toggle:
                hotkey_mapping[p_toggle] = self._on_toggle

            p_settings = qt_keysequence_to_pynput(self.settings_seq)
            if p_settings:
                hotkey_mapping[p_settings] = self._on_settings

            p_voice = qt_keysequence_to_pynput(self.voice_seq)
            if p_voice:
                hotkey_mapping[p_voice] = self._on_voice

            if hotkey_mapping:
                try:
                    self.listener = pynput_kb.GlobalHotKeys(hotkey_mapping)
                    self.listener.daemon = True
                    self.listener.start()
                    print(f"[Hotkeys] Bound global hotkeys: {list(hotkey_mapping.keys())}")
                except Exception as e:
                    print(f"[Hotkeys] Failed to bind global hotkeys: {e}")

    def stop_listener(self):
        if self.listener is not None:
            try:
                self.listener.stop()
            except Exception:
                pass
            self.listener = None

    def update_hotkeys(self, new_toggle: str, new_settings: str, new_voice: str):
        self.toggle_seq = new_toggle
        self.settings_seq = new_settings
        self.voice_seq = new_voice
        self.start_listener()


# ==============================================================================
# 7. GEMINI TEXT & VISION STREAMING WORKER (WITH MEMORY INJECTION)
# ==============================================================================

class GeminiTextWorker(QThread):
    """
    Worker thread that communicates with Google GenAI SDK models
    using client.models.generate_content_stream.
    Injects persistent user memory context into the system_instruction.
    """
    chunk_received = pyqtSignal(str)
    finished = pyqtSignal(str)
    error = pyqtSignal(str)

    def __init__(
        self,
        api_key: str,
        model: str,
        prompt: str,
        image: Optional[Image.Image] = None,
        memory_context: str = ""
    ):
        super().__init__()
        self.api_key = api_key
        self.model = model or "gemini-3.8-flash"
        self.prompt = prompt
        self.image = image
        self.memory_context = memory_context

    def run(self):
        api_key = self.api_key or os.environ.get("GEMINI_API_KEY", "").strip()
        if not api_key:
            self.error.emit("API Key is missing. Open Settings (Ctrl+Shift+,) to configure your Gemini API key.")
            return

        client = genai.Client(api_key=api_key)
        contents = []

        if self.image is not None:
            contents.append(self.image)

        prompt_text = self.prompt.strip()
        if not prompt_text and self.image is not None:
            prompt_text = "Analyze this screen capture in detail. Explain what you see, highlight relevant UI elements, and summarize any errors or actionable items."
        contents.append(prompt_text)

        # Build dynamic system instruction with persistent memories
        base_instruction = (
            "You are GeminiOverlay, a fast, sleek system-wide AI assistant for Windows.\n"
            "Format responses with clean Markdown, clear headings, and concise syntax-highlighted code blocks.\n"
            "Be fast, helpful, and natural.\n"
        )
        full_system_instruction = base_instruction + (self.memory_context or "")

        # Valid free models strictly: gemini-3.8-flash, gemini-3.5-flash-lite
        candidate_models = [self.model if self.model != "gemini-2.5-flash" else "gemini-3.8-flash"]
        if "gemini-3.5-flash-lite" not in candidate_models:
            candidate_models.append("gemini-3.5-flash-lite")

        last_error = None
        for attempt_model in candidate_models:
            for retry in range(2):
                try:
                    config = types.GenerateContentConfig(
                        system_instruction=full_system_instruction,
                        temperature=0.7
                    )

                    response_stream = client.models.generate_content_stream(
                        model=attempt_model,
                        contents=contents,
                        config=config
                    )

                    full_text = []
                    for chunk in response_stream:
                        if chunk.text:
                            full_text.append(chunk.text)
                            self.chunk_received.emit(chunk.text)

                    self.finished.emit("".join(full_text))
                    return

                except Exception as e:
                    last_error = e
                    err_msg = str(e)
                    print(f"[GeminiWorker] Attempt with {attempt_model} failed: {err_msg}")
                    # 503 UNAVAILABLE / high traffic backoff
                    if "503" in err_msg or "UNAVAILABLE" in err_msg:
                        time.sleep(1.2)
                        continue
                    break

        self.error.emit(f"Gemini API Error: {last_error}")


# ==============================================================================
# 8. GEMINI TTS PLAYER WORKER (ROUTED TO CHOSEN HEADPHONES/DEVICE)
# ==============================================================================

class TTSWorker(QThread):
    """
    Synthesizes and plays back answers using Gemini's native voice model.
    Routes audio output explicitly to the user's selected headphone/speaker device.
    """
    started_speaking = pyqtSignal()
    finished_speaking = pyqtSignal()
    error = pyqtSignal(str)

    def __init__(self, api_key: str, text: str, voice_name: str = "Puck", output_device=None):
        super().__init__()
        self.api_key = api_key
        self.text = text[:1500]  # Reasonable TTS threshold
        self.voice_name = voice_name
        self.output_device = output_device
        self._is_cancelled = False

    def cancel(self):
        self._is_cancelled = True
        try:
            sd.stop()
        except Exception:
            pass

    def run(self):
        api_key = self.api_key or os.environ.get("GEMINI_API_KEY", "").strip()
        if not api_key or not self.text:
            return

        self.started_speaking.emit()
        client = genai.Client(api_key=api_key)

        tts_models = ["gemini-3.8-flash", "gemini-3.5-flash-lite"]
        for tts_model in tts_models:
            if self._is_cancelled:
                break
            try:
                response = client.models.generate_content(
                    model=tts_model,
                    contents=self.text,
                    config=types.GenerateContentConfig(
                        response_modalities=["AUDIO"],
                        speech_config=types.SpeechConfig(
                            voice_config=types.VoiceConfig(
                                prebuilt_voice_config=types.PrebuiltVoiceConfig(
                                    voice_name=self.voice_name
                                )
                            )
                        )
                    )
                )

                if self._is_cancelled:
                    return

                candidates = getattr(response, "candidates", [])
                if candidates and candidates[0].content and candidates[0].content.parts:
                    part = candidates[0].content.parts[0]
                    if hasattr(part, "inline_data") and part.inline_data:
                        audio_bytes = part.inline_data.data
                        if isinstance(audio_bytes, str):
                            audio_bytes = base64.b64decode(audio_bytes)

                        if audio_bytes.startswith(b"RIFF"):
                            audio_bytes = audio_bytes[44:]

                        pcm_data = np.frombuffer(audio_bytes, dtype=np.int16)
                        # Route directly to chosen headphone/output device
                        sd.play(pcm_data, samplerate=24000, device=self.output_device)
                        sd.wait()
                        self.finished_speaking.emit()
                        return

            except Exception as e:
                print(f"[TTSWorker] Audio generation with {tts_model} failed: {e}")
                continue

        self.finished_speaking.emit()


# ==============================================================================
# 9. TWO-WAY GEMINI LIVE VOICE ENGINE (WITH DEVICE ROUTING & MEMORY)
# ==============================================================================

class LiveAudioSessionWorker(QThread):
    """
    Maintains real-time bidirectional audio conversation using Gemini Live API
    (`client.aio.live.connect`). Streams 16 kHz audio from input_device (microphone)
    and plays 24 kHz audio through output_device (headphones).
    """
    state_changed = pyqtSignal(str)             # "Listening", "Thinking", "Speaking", "Idle"
    user_transcription = pyqtSignal(str)
    model_transcription = pyqtSignal(str)
    session_error = pyqtSignal(str)
    session_closed = pyqtSignal()

    def __init__(
        self,
        api_key: str,
        live_model: str = "gemini-3.8-flash",
        voice_name: str = "Puck",
        input_device: Optional[int] = None,
        output_device: Optional[int] = None,
        headphones_mode: bool = False,
        memory_context: str = ""
    ):
        super().__init__()
        self.api_key = api_key
        self.live_model = "gemini-3.8-flash"
        self.voice_name = voice_name
        self.input_device = input_device
        self.output_device = output_device
        self.headphones_mode = headphones_mode
        self.memory_context = memory_context

        self.running = False
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._session = None
        self.audio_in_queue = asyncio.Queue()
        self.audio_out_queue: queue.Queue = queue.Queue(maxsize=120)
        self.is_ai_speaking = False
        self.screen_frame_event = asyncio.Event()
        self.pending_screen_frame: Optional[bytes] = None

    def trigger_screen_analysis(self):
        try:
            img = ImageGrab.grab()
            import io
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=75)
            self.pending_screen_frame = buf.getvalue()
            if self._loop and not self._loop.is_closed():
                self._loop.call_soon_threadsafe(self.screen_frame_event.set)
        except Exception as e:
            print(f"[LiveAudio] Screen grab error: {e}")

    def stop_session(self):
        self.running = False
        if self._loop and not self._loop.is_closed():
            self._loop.call_soon_threadsafe(self.screen_frame_event.set)

    def run(self):
        self.running = True
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        try:
            self._loop.run_until_complete(self._async_session_orchestrator())
        except Exception as e:
            print(f"[LiveAudio] Loop exception: {e}")
            self.session_error.emit(str(e))
        finally:
            self._loop.close()
            self.session_closed.emit()

    async def _async_session_orchestrator(self):
        api_key = self.api_key or os.environ.get("GEMINI_API_KEY", "").strip()
        if not api_key:
            self.session_error.emit("API key missing for Live Voice Session.")
            return

        client = genai.Client(api_key=api_key)

        system_prompt = (
            "You are GeminiOverlay live voice assistant for Windows. Respond conversationally, "
            "concisely, and naturally. Interrupt cleanly if the user speaks.\n"
            + (self.memory_context or "")
        )

        live_config = types.LiveConnectConfig(
            response_modalities=["AUDIO"],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(
                        voice_name=self.voice_name
                    )
                )
            ),
            system_instruction=types.Content(
                parts=[types.Part.from_text(text=system_prompt)]
            )
        )

        # Initialize input & output streams using selected devices
        def audio_input_callback(indata, frames, time_info, status):
            if not self.running:
                return
            if self.is_ai_speaking and not self.headphones_mode:
                return
            raw_bytes = bytes(indata)
            if self._loop and not self._loop.is_closed():
                self._loop.call_soon_threadsafe(self.audio_in_queue.put_nowait, raw_bytes)

        try:
            in_stream = sd.RawInputStream(
                samplerate=16000,
                channels=1,
                dtype="int16",
                blocksize=512,
                device=self.input_device,
                callback=audio_input_callback
            )
            out_stream = sd.RawOutputStream(
                samplerate=24000,
                channels=1,
                dtype="int16",
                device=self.output_device
            )
            in_stream.start()
            out_stream.start()
        except Exception as e:
            self.session_error.emit(f"Audio device initialization failed: {e}")
            return

        self.state_changed.emit("Listening")

        try:
            async with client.aio.live.connect(
                model=self.live_model,
                config=live_config
            ) as session:
                self._session = session
                send_task = asyncio.create_task(self._send_audio_loop(session))
                recv_task = asyncio.create_task(self._recv_audio_loop(session, out_stream))
                screen_task = asyncio.create_task(self._screen_watch_loop(session))

                while self.running:
                    await asyncio.sleep(0.1)

                send_task.cancel()
                recv_task.cancel()
                screen_task.cancel()
                await asyncio.gather(send_task, recv_task, screen_task, return_exceptions=True)

        except Exception as e:
            self.session_error.emit(f"Live voice session error: {e}")
        finally:
            try:
                in_stream.stop()
                in_stream.close()
                out_stream.stop()
                out_stream.close()
            except Exception:
                pass
            self.state_changed.emit("Idle")

    async def _send_audio_loop(self, session):
        while self.running:
            try:
                chunk = await self.audio_in_queue.get()
                if chunk:
                    await session.send_realtime_input(
                        audio=types.Blob(
                            data=chunk,
                            mime_type="audio/pcm;rate=16000"
                        )
                    )
            except asyncio.CancelledError:
                break
            except Exception:
                break

    async def _screen_watch_loop(self, session):
        while self.running:
            try:
                await self.screen_frame_event.wait()
                self.screen_frame_event.clear()
                if self.pending_screen_frame and self.running:
                    frame = self.pending_screen_frame
                    self.pending_screen_frame = None
                    await session.send_realtime_input(
                        video=types.Blob(
                            data=frame,
                            mime_type="image/jpeg"
                        )
                    )
            except asyncio.CancelledError:
                break
            except Exception:
                break

    async def _recv_audio_loop(self, session, out_stream: sd.RawOutputStream):
        while self.running:
            try:
                async for response in session.receive():
                    server_content = response.server_content
                    if server_content is None:
                        continue

                    if server_content.interrupted:
                        self.is_ai_speaking = False
                        self.state_changed.emit("Listening")
                        continue

                    model_turn = server_content.model_turn
                    if model_turn is not None:
                        for part in model_turn.parts:
                            if hasattr(part, "inline_data") and part.inline_data:
                                audio_bytes = part.inline_data.data
                                if isinstance(audio_bytes, str):
                                    audio_bytes = base64.b64decode(audio_bytes)
                                if not self.is_ai_speaking:
                                    self.is_ai_speaking = True
                                    self.state_changed.emit("Speaking")
                                out_stream.write(audio_bytes)

                            if hasattr(part, "text") and part.text:
                                self.model_transcription.emit(part.text)

                    if server_content.turn_complete:
                        self.is_ai_speaking = False
                        self.state_changed.emit("Listening")

            except asyncio.CancelledError:
                break
            except Exception:
                break


# ==============================================================================
# 10. DEDICATED SETTINGS & MEMORY MANAGER WINDOW
# ==============================================================================

class SettingsWindow(QDialog):
    """
    Dedicated, standalone Settings & Memory Manager Window.
    Opened via dedicated global hotkey (default Ctrl+Shift+,), tray menu,
    or the gear icon in the overlay pill.
    Features:
    - AI Model & DPAPI Key Configuration
    - Microphone and Headphone/Speaker routing
    - Hotkeys and Windows Startup
    - Dedicated Interactive Memory Manager (Add, Inspect, Delete, Clear)
    """

    def __init__(self, config_manager: ConfigManager, memory_manager: MemoryManager, startup_manager: StartupManager, parent=None):
        super().__init__(parent)
        self.cfg = config_manager
        self.mem = memory_manager
        self.startup = startup_manager

        self.setWindowTitle("GeminiOverlay - Settings & Memory Manager")
        self.setWindowIcon(create_gemini_icon(32))
        self.resize(580, 620)
        self.init_ui()

    def init_ui(self):
        # Clean dark neutral aesthetic (Charcoal / Slate, no garish purple)
        self.setStyleSheet("""
            QDialog {
                background: #0d1117;
                color: #f1f5f9;
                font-family: 'Segoe UI', -apple-system, sans-serif;
            }
            QTabWidget::pane {
                border: 1px solid rgba(255, 255, 255, 0.1);
                background: #161b22;
                border-radius: 12px;
                top: -1px;
            }
            QTabBar::tab {
                background: #0d1117;
                color: #94a3b8;
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-bottom: none;
                padding: 8px 18px;
                border-top-left-radius: 8px;
                border-top-right-radius: 8px;
                margin-right: 4px;
                font-size: 12.5px;
                font-weight: 600;
            }
            QTabBar::tab:selected {
                background: #161b22;
                color: #38bdf8;
                border-color: rgba(255, 255, 255, 0.15);
            }
            QLabel {
                color: #cbd5e1;
                font-size: 12px;
                font-weight: 500;
            }
            QLineEdit, QComboBox, QKeySequenceEdit {
                background: #0d1117;
                color: #f8fafc;
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 8px;
                padding: 7px 12px;
                font-size: 12px;
            }
            QLineEdit:focus, QComboBox:focus, QKeySequenceEdit:focus {
                border: 1px solid #38bdf8;
            }
            QCheckBox {
                color: #e2e8f0;
                font-size: 12px;
                spacing: 8px;
            }
            QCheckBox::indicator {
                width: 16px;
                height: 16px;
                border-radius: 4px;
                border: 1px solid rgba(255, 255, 255, 0.2);
                background: #0d1117;
            }
            QCheckBox::indicator:checked {
                background: #0284c7;
                border-color: #38bdf8;
            }
        """)

        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(18, 18, 18, 18)
        main_layout.setSpacing(14)

        # Header
        header_box = QHBoxLayout()
        logo_lbl = QLabel()
        logo_lbl.setPixmap(create_gemini_icon(28).pixmap(28, 28))
        header_box.addWidget(logo_lbl)

        title_lbl = QLabel("GeminiOverlay Settings")
        title_lbl.setStyleSheet("font-size: 16px; font-weight: 700; color: #ffffff;")
        header_box.addWidget(title_lbl)
        header_box.addStretch()

        btn_close_top = QPushButton("✕")
        btn_close_top.setStyleSheet("""
            QPushButton {
                background: transparent;
                border: none;
                color: #94a3b8;
                font-size: 15px;
                font-weight: bold;
            }
            QPushButton:hover {
                color: #ffffff;
            }
        """)
        btn_close_top.clicked.connect(self.close)
        header_box.addWidget(btn_close_top)
        main_layout.addLayout(header_box)

        # Tabs Container
        self.tabs = QTabWidget()
        main_layout.addWidget(self.tabs)

        # 1. AI Model Tab
        tab_ai = QWidget()
        layout_ai = QVBoxLayout(tab_ai)
        layout_ai.setContentsMargins(16, 16, 16, 16)
        layout_ai.setSpacing(12)

        layout_ai.addWidget(QLabel("Gemini API Key (Encrypted with Windows DPAPI):"))
        key_box = QHBoxLayout()
        self.edit_api_key = QLineEdit()
        self.edit_api_key.setEchoMode(QLineEdit.EchoMode.Password)
        self.edit_api_key.setPlaceholderText("Paste your Gemini API key (AIzaSy...)")
        self.edit_api_key.setText(self.cfg.get_api_key())
        key_box.addWidget(self.edit_api_key)

        self.btn_toggle_key = QPushButton("👁")
        self.btn_toggle_key.setFixedWidth(36)
        self.btn_toggle_key.setStyleSheet("background: #21262d; border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: #cbd5e1;")
        self.btn_toggle_key.clicked.connect(self.toggle_key_visibility)
        key_box.addWidget(self.btn_toggle_key)
        layout_ai.addLayout(key_box)

        layout_ai.addWidget(QLabel("Active Model (Strictly Valid Free-Tier Models):"))
        self.cb_model = QComboBox()
        # Strictly valid free-tier models (gemini-2.5-flash deprecated/returns 404)
        self.cb_model.addItems(["gemini-3.8-flash", "gemini-3.5-flash-lite"])
        cur_model = self.cfg.data.get("model", "gemini-3.8-flash")
        idx = self.cb_model.findText(cur_model)
        self.cb_model.setCurrentIndex(max(0, idx))
        layout_ai.addWidget(self.cb_model)

        layout_ai.addWidget(QLabel("AI Voice Persona (Gemini Live & TTS):"))
        self.cb_voice = QComboBox()
        self.cb_voice.addItems(["Puck", "Charon", "Kore", "Fenrir", "Aoede", "Zephyr"])
        v_idx = self.cb_voice.findText(self.cfg.data.get("voice_name", "Puck"))
        self.cb_voice.setCurrentIndex(max(0, v_idx))
        layout_ai.addWidget(self.cb_voice)

        layout_ai.addStretch()
        self.tabs.addTab(tab_ai, "AI Model")

        # 2. Audio & Devices Tab (Microphone & Headphone routing)
        tab_audio = QWidget()
        layout_audio = QVBoxLayout(tab_audio)
        layout_audio.setContentsMargins(16, 16, 16, 16)
        layout_audio.setSpacing(12)

        layout_audio.addWidget(QLabel("Microphone (Audio Input):"))
        self.cb_mic = QComboBox()
        self.populate_audio_devices(self.cb_mic, is_input=True)
        layout_audio.addWidget(self.cb_mic)

        layout_audio.addWidget(QLabel("Headphones / Speakers (Audio Output):"))
        self.cb_out = QComboBox()
        self.populate_audio_devices(self.cb_out, is_input=False)
        layout_audio.addWidget(self.cb_out)

        self.chk_speak_typed = QCheckBox("Speak typed answers aloud automatically with Gemini TTS")
        self.chk_speak_typed.setChecked(self.cfg.data.get("speak_typed_answers", True))
        layout_audio.addWidget(self.chk_speak_typed)

        self.chk_headphones = QCheckBox("I'm using headphones (enables seamless voice barge-in)")
        self.chk_headphones.setChecked(self.cfg.data.get("headphones_mode", False))
        layout_audio.addWidget(self.chk_headphones)

        layout_audio.addStretch()
        self.tabs.addTab(tab_audio, "Audio Devices")

        # 3. Hotkeys & Startup Tab
        tab_hk = QWidget()
        layout_hk = QVBoxLayout(tab_hk)
        layout_hk.setContentsMargins(16, 16, 16, 16)
        layout_hk.setSpacing(12)

        layout_hk.addWidget(QLabel("Toggle Assistant Overlay Hotkey (Default: Ctrl+Shift+Space):"))
        self.hk_toggle = QKeySequenceEdit(QKeySequence(self.cfg.data.get("hotkey_toggle", "Ctrl+Shift+Space")))
        layout_hk.addWidget(self.hk_toggle)

        layout_hk.addWidget(QLabel("Open Settings & Memory Panel Hotkey (Default: Ctrl+Shift+,):"))
        self.hk_settings = QKeySequenceEdit(QKeySequence(self.cfg.data.get("hotkey_settings", "Ctrl+Shift+,")))
        layout_hk.addWidget(self.hk_settings)

        layout_hk.addWidget(QLabel("Push-to-Talk / Instant Voice Chat (Default: Ctrl+Shift+V):"))
        self.hk_voice = QKeySequenceEdit(QKeySequence(self.cfg.data.get("hotkey_voice", "Ctrl+Shift+V")))
        layout_hk.addWidget(self.hk_voice)

        self.chk_startup = QCheckBox("Launch on Windows Startup (Run silently in System Tray)")
        self.chk_startup.setChecked(self.startup.is_enabled())
        layout_hk.addWidget(self.chk_startup)

        layout_hk.addStretch()
        self.tabs.addTab(tab_hk, "Hotkeys & System")

        # 4. MEMORY MANAGER TAB (Core Requirement #3)
        tab_mem = QWidget()
        layout_mem = QVBoxLayout(tab_mem)
        layout_mem.setContentsMargins(16, 16, 16, 16)
        layout_mem.setSpacing(10)

        mem_info = QLabel("Persistent memory rules are automatically injected into Gemini's system context:")
        mem_info.setStyleSheet("color: #94a3b8; font-size: 11.5px;")
        layout_mem.addWidget(mem_info)

        # Add new memory input
        add_box = QHBoxLayout()
        self.edit_new_memory = QLineEdit()
        self.edit_new_memory.setPlaceholderText("E.g. 'Always address me as King' or 'Prefer Python 3.12'")
        add_box.addWidget(self.edit_new_memory)

        btn_add_mem = QPushButton("+ Add Memory")
        btn_add_mem.setStyleSheet("""
            QPushButton {
                background: #0284c7;
                color: #ffffff;
                border: none;
                border-radius: 8px;
                padding: 7px 14px;
                font-weight: 600;
                font-size: 12px;
            }
            QPushButton:hover {
                background: #0369a1;
            }
        """)
        btn_add_mem.clicked.connect(self.handle_add_memory)
        add_box.addWidget(btn_add_mem)
        layout_mem.addLayout(add_box)

        # Scrollable memories container
        self.scroll_mem = QScrollArea()
        self.scroll_mem.setWidgetResizable(True)
        self.scroll_mem.setStyleSheet("QScrollArea { border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; background: #0d1117; }")

        self.mem_list_widget = QWidget()
        self.mem_list_layout = QVBoxLayout(self.mem_list_widget)
        self.mem_list_layout.setContentsMargins(8, 8, 8, 8)
        self.mem_list_layout.setSpacing(6)
        self.scroll_mem.setWidget(self.mem_list_widget)
        layout_mem.addWidget(self.scroll_mem, stretch=1)

        # Memory actions footer
        mem_foot = QHBoxLayout()
        self.lbl_mem_count = QLabel("")
        self.lbl_mem_count.setStyleSheet("color: #38bdf8; font-weight: 600; font-size: 11.5px;")
        mem_foot.addWidget(self.lbl_mem_count)
        mem_foot.addStretch()

        btn_clear_mem = QPushButton("Clear All Memories")
        btn_clear_mem.setStyleSheet("""
            QPushButton {
                background: rgba(239, 68, 68, 0.15);
                color: #f87171;
                border: 1px solid rgba(239, 68, 68, 0.3);
                border-radius: 6px;
                padding: 4px 10px;
                font-size: 11px;
            }
            QPushButton:hover {
                background: rgba(239, 68, 68, 0.3);
            }
        """)
        btn_clear_mem.clicked.connect(self.handle_clear_memories)
        mem_foot.addWidget(btn_clear_mem)
        layout_mem.addLayout(mem_foot)

        self.tabs.addTab(tab_mem, "🧠 Memory Manager")

        # Footer Save Bar
        foot_bar = QHBoxLayout()
        self.lbl_save_status = QLabel("")
        self.lbl_save_status.setStyleSheet("color: #34d399; font-weight: 600; font-size: 12px;")
        foot_bar.addWidget(self.lbl_save_status)
        foot_bar.addStretch()

        btn_save = QPushButton("Save & Apply Settings")
        btn_save.setStyleSheet("""
            QPushButton {
                background: #0284c7;
                color: #ffffff;
                border: none;
                border-radius: 8px;
                padding: 8px 22px;
                font-size: 13px;
                font-weight: 600;
            }
            QPushButton:hover {
                background: #0369a1;
            }
        """)
        btn_save.clicked.connect(self.save_settings)
        foot_bar.addWidget(btn_save)
        main_layout.addLayout(foot_bar)

        self.refresh_memory_list()

    def populate_audio_devices(self, combobox: QComboBox, is_input: bool):
        combobox.clear()
        combobox.addItem("System Default", None)
        try:
            devices = sd.query_devices()
            target_idx = self.cfg.data.get("input_device" if is_input else "output_device")
            selected_pos = 0
            for idx, dev in enumerate(devices):
                channels = dev["max_input_channels"] if is_input else dev["max_output_channels"]
                if channels > 0:
                    name = f"{dev['name']} (#{idx})"
                    combobox.addItem(name, idx)
                    if target_idx == idx:
                        selected_pos = combobox.count() - 1
            combobox.setCurrentIndex(selected_pos)
        except Exception as e:
            print(f"[Settings] Error querying devices: {e}")

    def toggle_key_visibility(self):
        if self.edit_api_key.echoMode() == QLineEdit.EchoMode.Password:
            self.edit_api_key.setEchoMode(QLineEdit.EchoMode.Normal)
            self.btn_toggle_key.setText("🔒")
        else:
            self.edit_api_key.setEchoMode(QLineEdit.EchoMode.Password)
            self.btn_toggle_key.setText("👁")

    def refresh_memory_list(self):
        """Cleans and re-renders the memory items in the scroll panel."""
        while self.mem_list_layout.count():
            item = self.mem_list_layout.takeAt(0)
            widget = item.widget()
            if widget:
                widget.deleteLater()

        memories = self.mem.get_all()
        self.lbl_mem_count.setText(f"{len(memories)} Active User Memories Stored")

        if not memories:
            empty_lbl = QLabel("No saved memories yet. Add rules above or tell Gemini in chat to remember something!")
            empty_lbl.setStyleSheet("color: #64748b; font-size: 12px; padding: 12px;")
            self.mem_list_layout.addWidget(empty_lbl)
            self.mem_list_layout.addStretch()
            return

        for m in memories:
            m_id = m.get("id")
            m_text = m.get("text", "")
            m_date = m.get("created_at", "")

            row_widget = QFrame()
            row_widget.setStyleSheet("""
                QFrame {
                    background: #161b22;
                    border: 1px solid rgba(255, 255, 255, 0.08);
                    border-radius: 8px;
                    padding: 4px;
                }
            """)
            row_layout = QHBoxLayout(row_widget)
            row_layout.setContentsMargins(10, 6, 10, 6)

            text_box = QVBoxLayout()
            lbl_m = QLabel(m_text)
            lbl_m.setStyleSheet("color: #f1f5f9; font-size: 12px; font-weight: 500;")
            lbl_m.setWordWrap(True)
            text_box.addWidget(lbl_m)

            if m_date:
                lbl_d = QLabel(f"Added {m_date}")
                lbl_d.setStyleSheet("color: #64748b; font-size: 10px;")
                text_box.addWidget(lbl_d)

            row_layout.addLayout(text_box, stretch=1)

            btn_del = QPushButton("🗑️")
            btn_del.setToolTip("Delete this memory")
            btn_del.setFixedSize(28, 28)
            btn_del.setStyleSheet("""
                QPushButton {
                    background: transparent;
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 6px;
                    color: #f87171;
                    font-size: 12px;
                }
                QPushButton:hover {
                    background: rgba(239, 68, 68, 0.2);
                    border-color: #ef4444;
                }
            """)
            btn_del.clicked.connect(lambda checked, mid=m_id: self.handle_delete_memory(mid))
            row_layout.addWidget(btn_del)

            self.mem_list_layout.addWidget(row_widget)

        self.mem_list_layout.addStretch()

    def handle_add_memory(self):
        text = self.edit_new_memory.text().strip()
        if text:
            self.mem.add_memory(text)
            self.edit_new_memory.clear()
            self.refresh_memory_list()

    def handle_delete_memory(self, memory_id: str):
        self.mem.remove_memory(memory_id)
        self.refresh_memory_list()

    def handle_clear_memories(self):
        reply = QMessageBox.question(
            self,
            "Clear All Memories?",
            "Are you sure you want to delete all saved memories and rules? This cannot be undone.",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
        )
        if reply == QMessageBox.StandardButton.Yes:
            self.mem.clear_all()
            self.refresh_memory_list()

    def save_settings(self):
        # 1. API Key
        raw_key = self.edit_api_key.text().strip()
        self.cfg.set_api_key(raw_key)

        # 2. Model & Voice
        self.cfg.data["model"] = self.cb_model.currentText()
        self.cfg.data["voice_name"] = self.cb_voice.currentText()

        # 3. Audio Devices
        self.cfg.data["input_device"] = self.cb_mic.currentData()
        self.cfg.data["output_device"] = self.cb_out.currentData()

        # 4. Options
        self.cfg.data["speak_typed_answers"] = self.chk_speak_typed.isChecked()
        self.cfg.data["headphones_mode"] = self.chk_headphones.isChecked()

        # 5. Startup Registry
        enable_startup = self.chk_startup.isChecked()
        self.cfg.data["start_with_windows"] = enable_startup
        self.startup.set_enabled(enable_startup)

        # 6. Hotkeys
        new_toggle = self.hk_toggle.keySequence().toString()
        new_settings = self.hk_settings.keySequence().toString()
        new_voice = self.hk_voice.keySequence().toString()

        if new_toggle:
            self.cfg.data["hotkey_toggle"] = new_toggle
        if new_settings:
            self.cfg.data["hotkey_settings"] = new_settings
        if new_voice:
            self.cfg.data["hotkey_voice"] = new_voice

        self.cfg.save()

        # Live re-bind global hotkeys
        global_app = QApplication.instance()
        if hasattr(global_app, "hotkey_manager"):
            global_app.hotkey_manager.update_hotkeys(
                self.cfg.data["hotkey_toggle"],
                self.cfg.data["hotkey_settings"],
                self.cfg.data["hotkey_voice"]
            )

        self.lbl_save_status.setText("✓ Settings & Memories Saved Successfully!")
        QTimer.singleShot(2500, lambda: self.lbl_save_status.setText(""))


# ==============================================================================
# 11. PROMPT INPUT BOX (ENTER TO SEND, SHIFT+ENTER FOR NEWLINE)
# ==============================================================================

class PromptInputBox(QPlainTextEdit):
    submit_requested = pyqtSignal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setPlaceholderText("Ask Gemini or give an instruction... (Enter to send)")
        self.setMaximumHeight(80)
        self.setMinimumHeight(38)
        self.setStyleSheet("""
            QPlainTextEdit {
                background: #0d1117;
                color: #f1f5f9;
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 10px;
                padding: 8px 12px;
                font-size: 13px;
                font-family: 'Segoe UI', -apple-system, sans-serif;
            }
            QPlainTextEdit:focus {
                border: 1px solid #38bdf8;
                background: #111722;
            }
        """)

    def keyPressEvent(self, event):
        if event.key() in (Qt.Key.Key_Return, Qt.Key.Key_Enter):
            if event.modifiers() & Qt.KeyboardModifier.ShiftModifier:
                super().keyPressEvent(event)
            else:
                self.submit_requested.emit()
                event.accept()
        else:
            super().keyPressEvent(event)


# ==============================================================================
# 12. BOTTOM-MIDDLE FLOATING ASSISTANT OVERLAY (MOBILE STYLE)
# ==============================================================================

class GeminiOverlayWindow(QMainWindow):
    """
    Sleek, borderless, floating assistant overlay anchored at the bottom-middle
    of the screen (similar to the mobile Gemini assistant overlay).
    - Compact idle pill state (~80px height).
    - Smoothly expands upward when answering.
    - Semi-Transparent Glassmorphism State: Shifts to subtle translucent glass
      (rgba(13, 16, 23, 0.72)) during active response/streaming so text underneath is visible.
    - Clean dark neutral charcoal styling (eliminating heavy purple dominance).
    """

    def __init__(
        self,
        config_manager: ConfigManager,
        memory_manager: MemoryManager,
        startup_manager: StartupManager
    ):
        super().__init__()
        self.cfg = config_manager
        self.mem = memory_manager
        self.startup = startup_manager

        # Settings dialog instance
        self.settings_window: Optional[SettingsWindow] = None

        # Workers
        self.text_worker: Optional[GeminiTextWorker] = None
        self.tts_worker: Optional[TTSWorker] = None
        self.live_worker: Optional[LiveAudioSessionWorker] = None

        # State
        self.is_pinned = self.cfg.data.get("pin_active", False)
        self.is_voice_active = False
        self.is_animating_hide = False
        self.is_answering = False
        self.chat_messages: List[Dict[str, Any]] = []
        self.current_ai_text = ""
        self.anim_group: Optional[QParallelAnimationGroup] = None
        self.anim_hide: Optional[QParallelAnimationGroup] = None

        self.init_window_flags()
        self.init_ui()

    def init_window_flags(self):
        self.setWindowFlags(
            Qt.WindowType.FramelessWindowHint |
            Qt.WindowType.WindowStaysOnTopHint |
            Qt.WindowType.Tool
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        self.setMinimumSize(480, 100)
        self.resize(640, 110)

    def init_ui(self):
        self.central_container = QWidget(self)
        self.setCentralWidget(self.central_container)
        outer_layout = QVBoxLayout(self.central_container)
        outer_layout.setContentsMargins(10, 8, 10, 8)

        # Main glassmorphic card container
        self.card = QFrame(self.central_container)
        self.card.setObjectName("AssistantCard")
        self.update_card_style(is_answering=False)

        # Soft ambient shadow
        shadow = QGraphicsDropShadowEffect(self.card)
        shadow.setBlurRadius(28)
        shadow.setColor(QColor(0, 0, 0, 190))
        shadow.setOffset(0, 6)
        self.card.setGraphicsEffect(shadow)

        self.card_layout = QVBoxLayout(self.card)
        self.card_layout.setContentsMargins(14, 10, 14, 12)
        self.card_layout.setSpacing(8)
        outer_layout.addWidget(self.card)

        # 1. Sleek Top Header (Logo, model pill, pin, settings gear, minimize)
        self.build_header()

        # 2. Response Area (QTextBrowser) - hidden initially until conversation begins
        self.browser = QTextBrowser()
        self.browser.setOpenExternalLinks(True)
        self.browser.setStyleSheet("""
            QTextBrowser {
                background: rgba(13, 17, 23, 0.55);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 12px;
                padding: 10px 14px;
                color: #f1f5f9;
                font-family: 'Segoe UI', -apple-system, sans-serif;
                font-size: 13px;
                line-height: 1.55;
            }
        """)
        self.browser.hide()
        self.card_layout.addWidget(self.browser, stretch=1)

        # 3. Status Bar (Thinking indicator, voice state, stop button)
        self.status_bar_widget = QWidget()
        status_layout = QHBoxLayout(self.status_bar_widget)
        status_layout.setContentsMargins(2, 0, 2, 0)
        status_layout.setSpacing(8)

        self.lbl_status = QLabel("")
        self.lbl_status.setStyleSheet("color: #38bdf8; font-size: 11.5px; font-weight: 600;")
        status_layout.addWidget(self.lbl_status)

        self.spinner = QProgressBar()
        self.spinner.setMaximum(0)
        self.spinner.setMinimum(0)
        self.spinner.setFixedHeight(3)
        self.spinner.setTextVisible(False)
        self.spinner.setStyleSheet("""
            QProgressBar {
                background: rgba(255, 255, 255, 0.08);
                border-radius: 2px;
                border: none;
            }
            QProgressBar::chunk {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 #38bdf8, stop:1 #818cf8);
                border-radius: 2px;
            }
        """)
        self.spinner.hide()
        status_layout.addWidget(self.spinner, stretch=1)

        self.btn_stop_audio = QPushButton("Stop ⏹")
        self.btn_stop_audio.setStyleSheet("""
            QPushButton {
                background: rgba(239, 68, 68, 0.2);
                border: 1px solid rgba(239, 68, 68, 0.4);
                border-radius: 6px;
                color: #f87171;
                font-size: 11px;
                padding: 2px 8px;
            }
            QPushButton:hover {
                background: rgba(239, 68, 68, 0.35);
            }
        """)
        self.btn_stop_audio.hide()
        self.btn_stop_audio.clicked.connect(self.stop_all_audio)
        status_layout.addWidget(self.btn_stop_audio)
        self.card_layout.addWidget(self.status_bar_widget)

        # 4. Floating Pill Input Row
        input_row = QHBoxLayout()
        input_row.setSpacing(8)

        # Screen capture button
        self.btn_screen = QPushButton("📷")
        self.btn_screen.setToolTip("Analyze Screen (hides briefly, grabs window/desktop)")
        self.btn_screen.setFixedSize(36, 36)
        self.btn_screen.setStyleSheet("""
            QPushButton {
                background: #161b22;
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 18px;
                color: #94a3b8;
                font-size: 14px;
            }
            QPushButton:hover {
                background: #21262d;
                border-color: #38bdf8;
                color: #f8fafc;
            }
        """)
        self.btn_screen.clicked.connect(self.handle_capture_screen)
        input_row.addWidget(self.btn_screen)

        # Input text box
        self.prompt_edit = PromptInputBox()
        self.prompt_edit.submit_requested.connect(self.handle_send_text)
        input_row.addWidget(self.prompt_edit, stretch=1)

        # Mic voice button
        self.btn_mic = QPushButton("🎙")
        self.btn_mic.setToolTip("Toggle Two-Way Voice (Default hotkey: Ctrl+Shift+V)")
        self.btn_mic.setFixedSize(36, 36)
        self.update_mic_button_style(active=False)
        self.btn_mic.clicked.connect(self.toggle_voice_session)
        input_row.addWidget(self.btn_mic)

        # Send button
        self.btn_send = QPushButton("➤")
        self.btn_send.setToolTip("Send message")
        self.btn_send.setFixedSize(36, 36)
        self.btn_send.setStyleSheet("""
            QPushButton {
                background: #0284c7;
                border: none;
                border-radius: 18px;
                color: #ffffff;
                font-size: 13px;
                font-weight: bold;
            }
            QPushButton:hover {
                background: #0369a1;
            }
            QPushButton:pressed {
                background: #075985;
            }
        """)
        self.btn_send.clicked.connect(self.handle_send_text)
        input_row.addWidget(self.btn_send)

        self.card_layout.addLayout(input_row)

    def update_card_style(self, is_answering: bool):
        """
        Dynamically shifts background between idle dark neutral look
        and semi-transparent glassmorphism look (Requirement #2).
        Translucent enough so screen and text underneath remain visible.
        """
        if is_answering:
            # Semi-transparent glassmorphic look: 72% opacity dark neutral
            self.card.setStyleSheet("""
                #AssistantCard {
                    background: rgba(13, 17, 23, 0.72);
                    border: 1px solid rgba(255, 255, 255, 0.14);
                    border-radius: 20px;
                }
            """)
        else:
            # Clean dark neutral charcoal look
            self.card.setStyleSheet("""
                #AssistantCard {
                    background: rgba(16, 21, 29, 0.94);
                    border: 1px solid rgba(255, 255, 255, 0.12);
                    border-radius: 20px;
                }
            """)

    def build_header(self):
        header = QWidget()
        header.setFixedHeight(30)
        h_layout = QHBoxLayout(header)
        h_layout.setContentsMargins(2, 0, 2, 0)
        h_layout.setSpacing(8)

        # Logo
        logo = QLabel()
        logo.setPixmap(create_gemini_icon(20).pixmap(20, 20))
        h_layout.addWidget(logo)

        # App title & active model tag
        title = QLabel("Gemini")
        title.setStyleSheet("color: #ffffff; font-weight: 700; font-size: 13px; font-family: 'Segoe UI';")
        h_layout.addWidget(title)

        cur_model = self.cfg.data.get("model", "gemini-3.8-flash")
        lbl_model = QLabel(cur_model)
        lbl_model.setStyleSheet("""
            QLabel {
                background: rgba(56, 189, 248, 0.12);
                color: #38bdf8;
                border: 1px solid rgba(56, 189, 248, 0.25);
                border-radius: 8px;
                padding: 1px 6px;
                font-size: 10px;
                font-weight: 600;
            }
        """)
        h_layout.addWidget(lbl_model)

        h_layout.addStretch()

        action_style = """
            QPushButton {
                background: transparent;
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 12px;
                width: 24px;
                height: 24px;
                color: #94a3b8;
                font-size: 11px;
            }
            QPushButton:hover {
                background: rgba(255, 255, 255, 0.1);
                color: #ffffff;
            }
        """

        # Memory indicator button
        self.btn_mem_badge = QPushButton("🧠")
        self.btn_mem_badge.setToolTip("Saved Memories Active (Click to open Memory Manager)")
        self.btn_mem_badge.setStyleSheet(action_style)
        self.btn_mem_badge.clicked.connect(self.open_settings_memory_tab)
        h_layout.addWidget(self.btn_mem_badge)

        # Pin toggle
        self.btn_pin = QPushButton("📌")
        self.btn_pin.setToolTip("Pin overlay (prevents auto-dismiss when clicking outside)")
        self.btn_pin.setStyleSheet(action_style)
        self.btn_pin.setCheckable(True)
        self.btn_pin.setChecked(self.is_pinned)
        self.btn_pin.clicked.connect(self.toggle_pin)
        h_layout.addWidget(self.btn_pin)

        # Settings gear button
        btn_settings = QPushButton("⚙️")
        btn_settings.setToolTip("Open Settings & Memory Manager (Ctrl+Shift+,)")
        btn_settings.setStyleSheet(action_style)
        btn_settings.clicked.connect(self.open_settings)
        h_layout.addWidget(btn_settings)

        # Minimize to tray
        btn_min = QPushButton("—")
        btn_min.setToolTip("Minimize to system tray")
        btn_min.setStyleSheet(action_style)
        btn_min.clicked.connect(self.hide_overlay)
        h_layout.addWidget(btn_min)

        self.card_layout.addWidget(header)

    def mousePressEvent(self, event):
        """Allows dragging the floating dock by clicking anywhere on the card header."""
        if event.button() == Qt.MouseButton.LeftButton:
            handle = self.windowHandle()
            if handle is not None and hasattr(handle, "startSystemMove"):
                handle.startSystemMove()
                event.accept()
                return
        super().mousePressEvent(event)

    def changeEvent(self, event):
        if event.type() == QEvent.Type.ActivationChange:
            if not self.isActiveWindow() and not self.is_pinned and not self.is_voice_active:
                QTimer.singleShot(180, self._check_auto_hide)
        super().changeEvent(event)

    def _check_auto_hide(self):
        if not self.isActiveWindow() and not self.is_pinned and not self.is_voice_active:
            if not (self.settings_window and self.settings_window.isVisible()):
                self.hide_overlay()

    def keyPressEvent(self, event):
        if event.key() == Qt.Key.Key_Escape:
            self.hide_overlay()
            event.accept()
        else:
            super().keyPressEvent(event)

    def toggle_pin(self):
        self.is_pinned = self.btn_pin.isChecked()
        self.cfg.data["pin_active"] = self.is_pinned
        self.cfg.save()

    def open_settings(self):
        if not self.settings_window:
            self.settings_window = SettingsWindow(self.cfg, self.mem, self.startup, self)
        self.settings_window.show()
        self.settings_window.raise_()
        self.settings_window.activateWindow()

    def open_settings_memory_tab(self):
        self.open_settings()
        if self.settings_window:
            self.settings_window.tabs.setCurrentIndex(3)

    # --------------------------------------------------------------------------
    # Messaging, Screen Capture, and Memory Auto-Detection
    # --------------------------------------------------------------------------

    def handle_send_text(self):
        prompt = self.prompt_edit.toPlainText().strip()
        if not prompt:
            return

        self.prompt_edit.clear()

        # Check for natural memory instructions:
        # e.g., "remember that my name is Alex", "remember: always reply in french"
        lower_prompt = prompt.lower()
        memorized_text = None
        for prefix in ("remember that ", "remember this:", "remember:", "memorize that ", "memorize:"):
            if lower_prompt.startswith(prefix):
                memorized_text = prompt[len(prefix):].strip()
                break

        if memorized_text:
            self.mem.add_memory(memorized_text)

        # Expand upwards into response state
        self.expand_for_chat()
        self.chat_messages.append({"role": "user", "text": prompt, "image": False})
        if memorized_text:
            self.chat_messages.append({
                "role": "system_note",
                "text": f"🧠 Memorized to persistent rules: \"{memorized_text}\""
            })

        self.current_ai_text = ""
        self.chat_messages.append({"role": "model", "text": "", "is_streaming": True})
        self.render_chat_view(is_streaming=True)
        self.execute_gemini_query(prompt, image=None)

    def handle_capture_screen(self):
        prompt = self.prompt_edit.toPlainText().strip()
        self.prompt_edit.clear()

        if self.is_voice_active and self.live_worker:
            self.chat_messages.append({"role": "user", "text": "[Look at my screen 📷]", "image": True})
            self.render_chat_view(is_streaming=False)
            self.live_worker.trigger_screen_analysis()
            return

        self.hide()
        QApplication.processEvents()
        time.sleep(0.2)

        try:
            screenshot = ImageGrab.grab()
        except Exception as e:
            self.show_overlay()
            self.append_error(f"Screen capture failed: {e}")
            return

        self.show_overlay()
        self.expand_for_chat()
        msg_header = f"[Captured Screen 📷] {prompt}" if prompt else "[Captured Screen 📷]"
        self.chat_messages.append({"role": "user", "text": msg_header, "image": True})
        self.current_ai_text = ""
        self.chat_messages.append({"role": "model", "text": "", "is_streaming": True})
        self.render_chat_view(is_streaming=True)
        self.execute_gemini_query(prompt, image=screenshot)

    def expand_for_chat(self):
        """Smoothly expands window height upward to accommodate the chat transcript."""
        if not self.browser.isVisible():
            self.browser.show()
            target_h = 420
            target_w = max(640, self.width())
            rect = self.calculate_bottom_center_geometry(w=target_w, h=target_h)
            self.setGeometry(rect)

    def execute_gemini_query(self, prompt: str, image: Optional[Image.Image] = None):
        api_key = self.cfg.get_api_key()
        if not api_key:
            self.append_error("No API Key configured. Press Ctrl+Shift+, or click ⚙️ to set your Gemini API key.")
            self.open_settings()
            return

        # Shift to semi-transparent glassmorphism state while actively responding
        self.update_card_style(is_answering=True)
        self.lbl_status.setText("Thinking...")
        self.spinner.show()
        self.btn_send.setEnabled(False)
        self.btn_screen.setEnabled(False)

        model = self.cfg.data.get("model", "gemini-3.8-flash")
        memory_ctx = self.mem.get_system_context()

        self.text_worker = GeminiTextWorker(
            api_key=api_key,
            model=model,
            prompt=prompt,
            image=image,
            memory_context=memory_ctx
        )
        self.text_worker.chunk_received.connect(self.on_chunk_received)
        self.text_worker.finished.connect(self.on_query_finished)
        self.text_worker.error.connect(self.on_query_error)
        self.text_worker.start()

    @pyqtSlot(str)
    def on_chunk_received(self, chunk: str):
        self.current_ai_text += chunk
        if self.chat_messages and self.chat_messages[-1]["role"] == "model":
            self.chat_messages[-1]["text"] = self.current_ai_text
        self.render_chat_view(is_streaming=True)

    @pyqtSlot(str)
    def on_query_finished(self, full_text: str):
        self.lbl_status.setText("")
        self.spinner.hide()
        self.btn_send.setEnabled(True)
        self.btn_screen.setEnabled(True)

        if self.chat_messages and self.chat_messages[-1]["role"] == "model":
            self.chat_messages[-1]["text"] = full_text
            self.chat_messages[-1]["is_streaming"] = False
        self.render_chat_view(is_streaming=False)

        # Automatic TTS read aloud routed to selected headphone/speaker device
        if self.cfg.data.get("speak_typed_answers", True) and full_text.strip():
            self.speak_text_aloud(full_text)

    @pyqtSlot(str)
    def on_query_error(self, err_msg: str):
        self.lbl_status.setText("")
        self.spinner.hide()
        self.btn_send.setEnabled(True)
        self.btn_screen.setEnabled(True)
        self.update_card_style(is_answering=False)
        self.append_error(err_msg)

    def speak_text_aloud(self, text: str):
        self.stop_all_audio()
        api_key = self.cfg.get_api_key()
        voice_name = self.cfg.data.get("voice_name", "Puck")
        out_dev = self.cfg.data.get("output_device", None)

        self.tts_worker = TTSWorker(api_key, text, voice_name, out_dev)
        self.tts_worker.started_speaking.connect(lambda: self.btn_stop_audio.show())
        self.tts_worker.finished_speaking.connect(lambda: self.btn_stop_audio.hide())
        self.tts_worker.start()

    def stop_all_audio(self):
        if self.tts_worker and self.tts_worker.isRunning():
            self.tts_worker.cancel()
        if self.live_worker and self.live_worker.isRunning():
            self.toggle_voice_session()
        self.btn_stop_audio.hide()

    def render_chat_view(self, is_streaming: bool = False):
        import html
        import re

        blocks = []
        for msg in self.chat_messages:
            role = msg.get("role", "")
            raw = msg.get("text", "")
            escaped = html.escape(raw)

            # Code block styling
            formatted = re.sub(
                r"```(.*?)```",
                r"<pre style='background: #0d1117; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 8px; color: #38bdf8; font-family: Consolas, monospace; font-size: 12px; margin: 4px 0;'>\1</pre>",
                escaped,
                flags=re.DOTALL
            )
            formatted = re.sub(r"`([^`]+)`", r"<code style='background: #1e2530; padding: 2px 5px; border-radius: 4px; color: #f472b6;'>\1</code>", formatted)
            formatted = re.sub(r"\*\*([^*]+)\*\*", r"<b style='color:#ffffff;'>\1</b>", formatted)
            formatted = formatted.replace("\n", "<br>")

            if role == "user":
                img_badge = "<span style='color: #38bdf8; font-weight: bold;'>[Screen 📷] </span>" if msg.get("image") else ""
                blocks.append(f"""
                <div style="margin: 8px 0 4px 0; text-align: right;">
                    <div style="display: inline-block; background: #0369a1; border-radius: 12px; padding: 6px 12px; color: #ffffff; font-size: 12.5px; text-align: left; max-width: 85%;">
                        <b>You:</b> {img_badge}{formatted}
                    </div>
                </div>
                """)
            elif role == "system_note":
                blocks.append(f"""
                <div style="margin: 4px 0; text-align: center;">
                    <span style="background: rgba(56, 189, 248, 0.12); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 10px; padding: 2px 10px; color: #38bdf8; font-size: 11px;">
                        {formatted}
                    </span>
                </div>
                """)
            elif role == "model":
                cursor = '<span style="color: #38bdf8; font-weight: bold;"> ▌</span>' if msg.get("is_streaming") else ""
                blocks.append(f"""
                <div style="margin: 6px 0 10px 0; text-align: left;">
                    <div style="color: #38bdf8; font-weight: bold; font-size: 11px; margin-bottom: 2px;">✦ Gemini:</div>
                    <div style="background: rgba(22, 27, 34, 0.65); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 8px 12px; color: #f1f5f9; font-size: 12.5px; line-height: 1.55;">
                        {formatted}{cursor}
                    </div>
                </div>
                """)
            elif role == "error":
                blocks.append(f"""
                <div style="margin: 6px 0; background: rgba(239, 68, 68, 0.15); border-left: 3px solid #ef4444; padding: 6px 10px; border-radius: 4px; color: #fca5a5; font-size: 12px;">
                    <b>Error:</b> {formatted}
                </div>
                """)

        doc_html = f"""
        <html>
        <head>
            <style>
                body {{ font-family: 'Segoe UI', -apple-system, sans-serif; margin: 2px; padding: 0; background: transparent; color: #f1f5f9; }}
            </style>
        </head>
        <body>
            {"".join(blocks)}
        </body>
        </html>
        """
        self.browser.setHtml(doc_html)
        self.scroll_to_bottom()

    def append_error(self, err_text: str):
        self.expand_for_chat()
        self.chat_messages.append({"role": "error", "text": err_text})
        self.render_chat_view(is_streaming=False)

    def scroll_to_bottom(self):
        scrollbar = self.browser.verticalScrollBar()
        scrollbar.setValue(scrollbar.maximum())

    # --------------------------------------------------------------------------
    # Live Voice Mode
    # --------------------------------------------------------------------------

    def toggle_voice_session(self):
        if self.is_voice_active:
            self.end_voice_session()
        else:
            self.start_voice_session()

    def start_voice_session(self):
        api_key = self.cfg.get_api_key()
        if not api_key:
            self.append_error("Please configure your Gemini API Key in Settings first.")
            self.open_settings()
            return

        self.expand_for_chat()
        self.is_voice_active = True
        self.update_mic_button_style(active=True)
        self.lbl_status.setText("Connecting Live Voice...")
        self.btn_stop_audio.show()
        self.update_card_style(is_answering=True)

        voice_name = self.cfg.data.get("voice_name", "Puck")
        in_dev = self.cfg.data.get("input_device")
        out_dev = self.cfg.data.get("output_device")
        headphones = self.cfg.data.get("headphones_mode", False)
        memory_ctx = self.mem.get_system_context()

        self.live_worker = LiveAudioSessionWorker(
            api_key=api_key,
            live_model="gemini-3.8-flash",
            voice_name=voice_name,
            input_device=in_dev,
            output_device=out_dev,
            headphones_mode=headphones,
            memory_context=memory_ctx
        )
        self.live_worker.state_changed.connect(self.on_live_state_changed)
        self.live_worker.user_transcription.connect(self.on_live_user_transcription)
        self.live_worker.model_transcription.connect(self.on_live_model_transcription)
        self.live_worker.session_error.connect(self.on_live_error)
        self.live_worker.session_closed.connect(self.on_live_closed)
        self.live_worker.start()

    def end_voice_session(self):
        self.lbl_status.setText("Ending voice session...")
        if self.live_worker:
            self.live_worker.stop_session()

    @pyqtSlot(str)
    def on_live_state_changed(self, state: str):
        if state == "Listening":
            self.lbl_status.setText("Listening 🎙")
        elif state == "Thinking":
            self.lbl_status.setText("Thinking 💭")
        elif state == "Speaking":
            self.lbl_status.setText("Speaking 🔊")
        elif state == "Idle":
            self.lbl_status.setText("")

    @pyqtSlot(str)
    def on_live_user_transcription(self, text: str):
        self.chat_messages.append({"role": "user", "text": f"[Voice] {text}", "image": False})
        self.render_chat_view(is_streaming=False)

    @pyqtSlot(str)
    def on_live_model_transcription(self, text: str):
        if not self.chat_messages or self.chat_messages[-1].get("role") != "model":
            self.chat_messages.append({"role": "model", "text": text, "is_streaming": False})
        else:
            self.chat_messages[-1]["text"] = text
        self.render_chat_view(is_streaming=False)

    @pyqtSlot(str)
    def on_live_error(self, err: str):
        self.append_error(err)
        self.end_voice_session()

    @pyqtSlot()
    def on_live_closed(self):
        self.is_voice_active = False
        self.update_mic_button_style(active=False)
        self.btn_stop_audio.hide()
        self.lbl_status.setText("")
        self.update_card_style(is_answering=False)

    def update_mic_button_style(self, active: bool):
        if active:
            self.btn_mic.setStyleSheet("""
                QPushButton {
                    background: #dc2626;
                    border: 2px solid #f87171;
                    border-radius: 18px;
                    color: #ffffff;
                    font-size: 14px;
                }
            """)
        else:
            self.btn_mic.setStyleSheet("""
                QPushButton {
                    background: #161b22;
                    border: 1px solid rgba(255, 255, 255, 0.12);
                    border-radius: 18px;
                    color: #38bdf8;
                    font-size: 14px;
                }
                QPushButton:hover {
                    background: #21262d;
                    border-color: #38bdf8;
                    color: #ffffff;
                }
            """)

    # --------------------------------------------------------------------------
    # Bottom-Center Floating Positioning & Slide Animations
    # --------------------------------------------------------------------------

    def calculate_bottom_center_geometry(self, w: int = 640, h: int = 110) -> QRect:
        primary = QGuiApplication.primaryScreen()
        if not primary:
            return QRect(200, 200, w, h)
        avail = primary.availableGeometry()
        x = avail.x() + (avail.width() - w) // 2
        y = avail.bottom() - h - 25  # 25px above taskbar
        return QRect(x, y, w, h)

    def show_overlay(self, start_voice: bool = False):
        curr_h = 420 if self.browser.isVisible() else 110
        target_rect = self.calculate_bottom_center_geometry(self.width(), curr_h)
        start_rect = QRect(target_rect.x(), target_rect.y() + 35, target_rect.width(), target_rect.height())

        self.setGeometry(start_rect)
        self.setWindowOpacity(0.0)
        self.show()
        self.raise_()
        self.activateWindow()
        force_activate_window(int(self.winId()))
        self.prompt_edit.setFocus()

        self.anim_group = QParallelAnimationGroup(self)
        pos_anim = QPropertyAnimation(self, b"geometry")
        pos_anim.setDuration(200)
        pos_anim.setStartValue(start_rect)
        pos_anim.setEndValue(target_rect)
        pos_anim.setEasingCurve(QEasingCurve.Type.OutCubic)

        fade_anim = QPropertyAnimation(self, b"windowOpacity")
        fade_anim.setDuration(200)
        fade_anim.setStartValue(0.0)
        fade_anim.setEndValue(1.0)
        fade_anim.setEasingCurve(QEasingCurve.Type.OutCubic)

        self.anim_group.addAnimation(pos_anim)
        self.anim_group.addAnimation(fade_anim)
        self.anim_group.start()

        if start_voice and not self.is_voice_active:
            QTimer.singleShot(220, self.start_voice_session)

    def hide_overlay(self):
        if not self.isVisible() or self.is_animating_hide:
            return

        self.is_animating_hide = True
        curr = self.geometry()
        end_rect = QRect(curr.x(), curr.y() + 25, curr.width(), curr.height())

        self.anim_hide = QParallelAnimationGroup(self)
        pos_anim = QPropertyAnimation(self, b"geometry")
        pos_anim.setDuration(150)
        pos_anim.setStartValue(curr)
        pos_anim.setEndValue(end_rect)
        pos_anim.setEasingCurve(QEasingCurve.Type.InQuad)

        fade_anim = QPropertyAnimation(self, b"windowOpacity")
        fade_anim.setDuration(150)
        fade_anim.setStartValue(self.windowOpacity())
        fade_anim.setEndValue(0.0)
        fade_anim.setEasingCurve(QEasingCurve.Type.InQuad)

        self.anim_hide.addAnimation(pos_anim)
        self.anim_hide.addAnimation(fade_anim)

        def on_hide_finished():
            self.hide()
            self.is_animating_hide = False
            self.stop_all_audio()

        self.anim_hide.finished.connect(on_hide_finished)
        self.anim_hide.start()

    def toggle_overlay(self):
        if self.isVisible() and not self.is_animating_hide:
            self.hide_overlay()
        else:
            self.show_overlay(start_voice=False)

    def show_and_start_voice(self):
        if not self.isVisible() or self.is_animating_hide:
            self.show_overlay(start_voice=True)
        else:
            self.toggle_voice_session()


# ==============================================================================
# 13. SYSTEM TRAY MANAGER
# ==============================================================================

class SystemTrayManager(QObject):
    def __init__(self, overlay: GeminiOverlayWindow, startup: StartupManager):
        super().__init__()
        self.overlay = overlay
        self.startup = startup

        self.tray_icon = QSystemTrayIcon(create_gemini_icon(32), overlay)
        self.tray_icon.setToolTip("GeminiOverlay - Windows AI Assistant")

        self.menu = QMenu()
        self.menu.setStyleSheet("""
            QMenu {
                background: #0d1117;
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 8px;
                padding: 4px;
                color: #e2e8f0;
                font-family: 'Segoe UI';
            }
            QMenu::item {
                padding: 6px 18px;
                border-radius: 4px;
            }
            QMenu::item:selected {
                background: #0284c7;
                color: #ffffff;
            }
        """)

        # Actions
        act_open = QAction("Open Gemini Dock", self)
        act_open.triggered.connect(self.overlay.show_overlay)
        self.menu.addAction(act_open)

        act_settings = QAction("Settings & Memory Manager", self)
        act_settings.triggered.connect(self.overlay.open_settings)
        self.menu.addAction(act_settings)

        self.menu.addSeparator()

        self.act_startup = QAction("Start with Windows", self)
        self.act_startup.setCheckable(True)
        self.act_startup.setChecked(self.startup.is_enabled())
        self.act_startup.triggered.connect(self.toggle_startup)
        self.menu.addAction(self.act_startup)

        self.menu.addSeparator()

        act_exit = QAction("Exit GeminiOverlay", self)
        act_exit.triggered.connect(self.clean_exit)
        self.menu.addAction(act_exit)

        self.tray_icon.setContextMenu(self.menu)
        self.tray_icon.activated.connect(self.on_tray_activated)
        self.tray_icon.show()

    def on_tray_activated(self, reason: QSystemTrayIcon.ActivationReason):
        if reason == QSystemTrayIcon.ActivationReason.Trigger:
            self.overlay.toggle_overlay()

    def toggle_startup(self, checked: bool):
        self.startup.set_enabled(checked)
        self.overlay.cfg.data["start_with_windows"] = checked
        self.overlay.cfg.save()

    def clean_exit(self):
        if self.overlay.live_worker:
            self.overlay.live_worker.stop_session()

        app = QApplication.instance()
        if hasattr(app, "hotkey_manager"):
            app.hotkey_manager.stop_listener()

        self.tray_icon.hide()
        QApplication.quit()


# ==============================================================================
# 14. SINGLE-INSTANCE LOCK & MAIN ENTRY POINT
# ==============================================================================

def main():
    try:
        QApplication.setHighDpiScaleFactorRoundingPolicy(
            Qt.HighDpiScaleFactorRoundingPolicy.PassThrough
        )
    except Exception:
        pass

    app = QApplication(sys.argv)
    app.setQuitOnLastWindowClosed(False)

    # Enforce Single-Instance via QLockFile
    lock_path = os.path.join(QDir.tempPath(), "GeminiOverlay.lock")
    lock_file = QLockFile(lock_path)
    if not lock_file.tryLock(100):
        print("[Instance] Another instance of GeminiOverlay is already running. Exiting.")
        sys.exit(0)

    # Initialize Core Managers
    cfg_manager = ConfigManager()
    mem_manager = MemoryManager()
    startup_manager = StartupManager()

    # Initialize Overlay Window & System Tray
    overlay_window = GeminiOverlayWindow(cfg_manager, mem_manager, startup_manager)
    tray_manager = SystemTrayManager(overlay_window, startup_manager)

    # Initialize Global Hotkeys
    toggle_hk = cfg_manager.data.get("hotkey_toggle", "Ctrl+Shift+Space")
    settings_hk = cfg_manager.data.get("hotkey_settings", "Ctrl+Shift+,")
    voice_hk = cfg_manager.data.get("hotkey_voice", "Ctrl+Shift+V")

    hotkey_manager = GlobalHotkeyManager(toggle_hk, settings_hk, voice_hk)
    hotkey_manager.toggle_requested.connect(overlay_window.toggle_overlay)
    hotkey_manager.settings_requested.connect(overlay_window.open_settings)
    hotkey_manager.voice_requested.connect(overlay_window.show_and_start_voice)

    app.hotkey_manager = hotkey_manager
    app.tray_manager = tray_manager

    # Show overlay initially
    overlay_window.show_overlay()

    exit_code = app.exec()
    lock_file.unlock()
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
