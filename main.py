"""
GeminiOverlay - Production System-Wide Floating AI Assistant for Windows
========================================================================
Architecture:
- GUI Thread: PyQt6 frameless translucent glassmorphic window with system tray and custom titlebar.
- Hotkey Listener: pynput.keyboard.GlobalHotKeys running in a background thread, dispatching to Qt via signals.
- Gemini Text/Vision: QThread worker executing streaming responses via `google.genai`.
- Gemini Live Voice: Dedicated QThread with an asyncio event loop running `client.aio.live.connect`,
  sounddevice 16 kHz mono microphone capture, 24 kHz low-latency output, barge-in detection,
  and bidirectional transcription.
- Windows Security & Integration: Windows DPAPI credential encryption at rest via `win32crypt`,
  user startup registry integration via `winreg`, and win32 foreground-focus enforcement.
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
from typing import Optional, Dict, Any, List

# Windows specific native libraries
import winreg
try:
    import win32gui
    import win32con
    import win32process
    import win32crypt
except ImportError:
    # Fallback placeholders for non-Windows development/linting environments
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
    QLockFile, QDir, QTimer, QObject, QEvent
)
from PyQt6.QtGui import (
    QIcon, QPixmap, QPainter, QColor, QRadialGradient, QLinearGradient,
    QBrush, QPen, QFont, QKeySequence, QGuiApplication, QAction, QCursor
)
from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QStackedLayout, QTextBrowser, QPlainTextEdit, QPushButton, QLabel,
    QLineEdit, QComboBox, QCheckBox, QKeySequenceEdit, QSystemTrayIcon,
    QMenu, QSizeGrip, QGraphicsDropShadowEffect, QFrame, QProgressBar,
    QMessageBox
)


# ==============================================================================
# 1. ICON GENERATOR & ASSETS
# ==============================================================================

def create_gemini_icon(size: int = 64) -> QIcon:
    """
    Generates a crisp, high-DPI purple/violet radial gradient icon with
    the iconic Gemini star/diamond sparkle geometry using QPainter.
    Avoids external file dependency and ensures clean rendering in the tray.
    """
    pixmap = QPixmap(size, size)
    pixmap.fill(Qt.GlobalColor.transparent)

    painter = QPainter(pixmap)
    painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)

    # Outer ambient glow
    radial = QRadialGradient(size / 2, size / 2, size / 2)
    radial.setColorAt(0.0, QColor(147, 51, 234, 255))   # Bright Violet
    radial.setColorAt(0.65, QColor(79, 70, 229, 220))  # Indigo
    radial.setColorAt(1.0, QColor(15, 23, 42, 0))      # Transparent edge
    painter.setBrush(QBrush(radial))
    painter.setPen(Qt.PenStyle.NoPen)
    painter.drawEllipse(2, 2, size - 4, size - 4)

    # Inner Gemini sparkle diamond
    painter.setPen(QPen(QColor(255, 255, 255, 240), 2.5))
    painter.setBrush(QBrush(QColor(255, 255, 255, 220)))

    cx, cy = size / 2, size / 2
    r_outer = size * 0.32
    r_inner = size * 0.10

    # 4-point star path
    from PyQt6.QtGui import QPainterPath
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
# 2. CONFIGURATION MANAGER (DPAPI ENCRYPTION & JSON PERSISTENCE)
# ==============================================================================

class ConfigManager:
    """
    Manages persistent configuration stored in %APPDATA%\\GeminiOverlay\\config.json.
    Secures API keys at rest using Windows DPAPI (CryptProtectData / CryptUnprotectData).
    """

    DEFAULT_CONFIG = {
        "api_key_encrypted": "",
        "model": "gemini-3.8-flash",
        "live_model": "gemini-3.8-live",
        "hotkey_toggle": "Ctrl+Shift+Space",
        "hotkey_voice": "Ctrl+Shift+V",
        "start_with_windows": False,
        "voice_name": "Puck",
        "input_device": None,
        "output_device": None,
        "speak_typed_answers": False,
        "headphones_mode": False,
        "pin_active": False,
        "window_geometry": {
            "x": -1,
            "y": -1,
            "width": 460,
            "height": 620
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
                # CryptProtectData: data, description, optional_entropy, reserved, prompt_struct, flags
                encrypted_bytes = win32crypt.CryptProtectData(
                    raw_bytes, "GeminiOverlayKey", None, None, None, 0
                )
                return base64.b64encode(encrypted_bytes).decode("ascii")
            except Exception as e:
                print(f"[Config] DPAPI Encryption error: {e}")
        # Fallback (non-Windows or mock)
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
        # Fallback
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

        # Automatically migrate deprecated model names (e.g., gemini-2.5-flash) to active Gemini models
        deprecated_models = {
            "gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite",
            "gemini-2.0-flash", "gemini-2.0-pro", "gemini-1.5-flash", "gemini-1.5-pro",
            "gemini-2.0-flash-exp"
        }
        migrated = False
        if self.data.get("model") in deprecated_models or not self.data.get("model"):
            self.data["model"] = "gemini-3.8-flash"
            migrated = True

        if self.data.get("live_model") in deprecated_models or not self.data.get("live_model"):
            self.data["live_model"] = "gemini-3.8-live"
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
        return self.decrypt_secret(self.data.get("api_key_encrypted", ""))

    def set_api_key(self, raw_key: str):
        self.data["api_key_encrypted"] = self.encrypt_secret(raw_key.strip())


# ==============================================================================
# 3. STARTUP MANAGER (WINDOWS REGISTRY INTEGRATION)
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
            # Running as bundled PyInstaller EXE
            exe_path = sys.executable
            return f'"{exe_path}"'
        else:
            # Running as Python script
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
                    print(f"[Startup] Registered startup command: {cmd}")
                else:
                    try:
                        winreg.DeleteValue(key, cls.APP_NAME)
                        print("[Startup] Removed startup command from registry")
                    except FileNotFoundError:
                        pass
            return True
        except Exception as e:
            print(f"[Startup] Error modifying registry: {e}")
            return False


# ==============================================================================
# 4. WINDOWS FOREGROUND FOCUS HELPER
# ==============================================================================

def force_activate_window(hwnd: int):
    """
    Forces Windows to yield foreground focus to the overlay window even when
    invoked from a global hotkey or background thread. Windows OS restricts
    SetForegroundWindow unless threads are attached via AttachThreadInput.
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
# 5. GLOBAL HOTKEY MANAGER (PYNPUT THREAD -> QT SIGNALS)
# ==============================================================================

def qt_keysequence_to_pynput(seq_str: str) -> Optional[str]:
    """
    Converts Qt QKeySequence string representations (e.g., 'Ctrl+Shift+Space')
    into valid pynput format (e.g., '<ctrl>+<shift>+<space>').
    """
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
    }

    for part in parts:
        low = part.lower()
        if low in key_map:
            pynput_parts.append(key_map[low])
        elif len(part) == 1:
            pynput_parts.append(part.lower())
        else:
            # Function keys like F1-F12
            if low.startswith("f") and low[1:].isdigit():
                pynput_parts.append(f"<{low}>")
            else:
                pynput_parts.append(f"<{low}>")

    return "+".join(pynput_parts)


class GlobalHotkeyManager(QObject):
    """
    Runs pynput.keyboard.GlobalHotKeys inside an independent thread and safely
    bridges hotkey trigger events into Qt signals.
    """
    toggle_requested = pyqtSignal()
    voice_requested = pyqtSignal()

    def __init__(self, toggle_seq: str, voice_seq: str):
        super().__init__()
        self.toggle_seq = toggle_seq
        self.voice_seq = voice_seq
        self.listener: Optional[pynput_kb.GlobalHotKeys] = None
        self._lock = threading.Lock()
        self.start_listener()

    def _on_toggle(self):
        self.toggle_requested.emit()

    def _on_voice(self):
        self.voice_requested.emit()

    def start_listener(self):
        with self._lock:
            self.stop_listener()
            hotkey_mapping = {}

            pynput_toggle = qt_keysequence_to_pynput(self.toggle_seq)
            if pynput_toggle:
                hotkey_mapping[pynput_toggle] = self._on_toggle

            pynput_voice = qt_keysequence_to_pynput(self.voice_seq)
            if pynput_voice:
                hotkey_mapping[pynput_voice] = self._on_voice

            if hotkey_mapping:
                try:
                    self.listener = pynput_kb.GlobalHotKeys(hotkey_mapping)
                    self.listener.daemon = True
                    self.listener.start()
                    print(f"[Hotkeys] Registered global hotkeys: {list(hotkey_mapping.keys())}")
                except Exception as e:
                    print(f"[Hotkeys] Failed to bind global hotkeys: {e}")

    def stop_listener(self):
        if self.listener is not None:
            try:
                self.listener.stop()
            except Exception:
                pass
            self.listener = None

    def update_hotkeys(self, new_toggle: str, new_voice: str):
        self.toggle_seq = new_toggle
        self.voice_seq = new_voice
        self.start_listener()


# ==============================================================================
# 6. GEMINI TEXT & VISION STREAMING WORKER
# ==============================================================================

class GeminiTextWorker(QThread):
    """
    Worker thread that communicates with Google GenAI SDK models
    using client.models.generate_content_stream so the PyQt6 UI stays fluid.
    Supports multiline text prompts as well as attached screen capture images.
    """
    chunk_received = pyqtSignal(str)
    finished = pyqtSignal(str)
    error = pyqtSignal(str)

    def __init__(self, api_key: str, model: str, prompt: str, image: Optional[Image.Image] = None):
        super().__init__()
        self.api_key = api_key
        self.model = model
        self.prompt = prompt
        self.image = image

    def run(self):
        if not self.api_key:
            self.error.emit("API Key is missing. Open Settings to set your Gemini API key.")
            return

        try:
            client = genai.Client(api_key=self.api_key)
            contents = []

            # Add vision image if present
            if self.image is not None:
                contents.append(self.image)

            prompt_text = self.prompt.strip()
            if not prompt_text and self.image is not None:
                prompt_text = "Analyze this screen capture in detail. Explain what you see, highlight relevant UI elements, and summarize any errors or actionable items."
            contents.append(prompt_text)

            response_stream = client.models.generate_content_stream(
                model=self.model,
                contents=contents
            )

            full_text = []
            for chunk in response_stream:
                if chunk.text:
                    full_text.append(chunk.text)
                    self.chunk_received.emit(chunk.text)

            self.finished.emit("".join(full_text))

        except Exception as e:
            err_msg = str(e)
            print(f"[GeminiWorker] Error during streaming: {traceback.format_exc()}")
            self.error.emit(f"Gemini API Error: {err_msg}")


# ==============================================================================
# 7. GEMINI TTS PLAYER WORKER (SPEAK TYPED ANSWERS ALOUD)
# ==============================================================================

class TTSWorker(QThread):
    """
    Synthesizes and plays back typed answers using Gemini's native voice model.
    Runs in a background thread and streams 24 kHz audio via sounddevice.
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
        if not self.api_key or not self.text:
            return

        try:
            self.started_speaking.emit()
            client = genai.Client(api_key=self.api_key)

            # Query unary TTS using official TTS model
            response = client.models.generate_content(
                model="gemini-3.8-flash-lite-tts",
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

                    # 24kHz mono 16-bit PCM playback
                    # Skip 44-byte WAV header if present (RIFF header)
                    if audio_bytes.startswith(b"RIFF"):
                        audio_bytes = audio_bytes[44:]

                    pcm_data = np.frombuffer(audio_bytes, dtype=np.int16)
                    sd.play(pcm_data, samplerate=24000, device=self.output_device)
                    sd.wait()

            self.finished_speaking.emit()

        except Exception as e:
            print(f"[TTSWorker] Error: {e}")
            self.error.emit(str(e))
            self.finished_speaking.emit()


# ==============================================================================
# 8. TWO-WAY GEMINI LIVE VOICE ENGINE
# ==============================================================================

class LiveAudioSessionWorker(QThread):
    """
    Maintains real-time bidirectional audio conversation using Gemini Live API
    (`client.aio.live.connect`). Owns a dedicated asyncio loop inside QThread.

    Audio specifications:
    - Capture: 16 kHz, 16-bit Mono PCM streamed in 512-sample chunks.
    - Playback: 24 kHz, 16-bit Mono PCM through a low-latency sounddevice output stream.
    - Features: Automatic barge-in cancellation, acoustic feedback gating,
      input/output transcription, and realtime screen frame injection.
    """
    state_changed = pyqtSignal(str)             # "Listening", "Thinking", "Speaking", "Idle"
    user_transcription = pyqtSignal(str)        # Transcribed user voice
    model_transcription = pyqtSignal(str)       # Transcribed AI response
    session_error = pyqtSignal(str)             # Surfaced error message
    session_closed = pyqtSignal()

    def __init__(
        self,
        api_key: str,
        live_model: str = "gemini-3.8-live",
        voice_name: str = "Puck",
        input_device: Optional[int] = None,
        output_device: Optional[int] = None,
        headphones_mode: bool = False
    ):
        super().__init__()
        self.api_key = api_key
        self.live_model = live_model
        self.voice_name = voice_name
        self.input_device = input_device
        self.output_device = output_device
        self.headphones_mode = headphones_mode

        self.running = False
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._session = None

        # Thread-safe audio queues
        self.audio_in_queue = asyncio.Queue()
        self.audio_out_queue: queue.Queue = queue.Queue(maxsize=120)
        self.is_ai_speaking = False
        self.screen_frame_event = asyncio.Event()
        self.pending_screen_frame: Optional[bytes] = None

    def trigger_screen_analysis(self):
        """Grabs the screen and queues an image frame for the live session."""
        try:
            screenshot = ImageGrab.grab()
            screenshot.thumbnail((1280, 720))  # Efficient resolution for live vision
            import io
            buf = io.BytesIO()
            screenshot.save(buf, format="JPEG", quality=80)
            self.pending_screen_frame = buf.getvalue()
            if self._loop and self._loop.is_running():
                self._loop.call_soon_threadsafe(self.screen_frame_event.set)
        except Exception as e:
            print(f"[LiveAudio] Screen grab error: {e}")

    def stop_session(self):
        """Signals the session to terminate cleanly."""
        self.running = False
        if self._loop and self._loop.is_running():
            self._loop.call_soon_threadsafe(self.screen_frame_event.set)

    def run(self):
        """QThread entry point: initializes dedicated asyncio event loop."""
        self.running = True
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)

        try:
            self._loop.run_until_complete(self._main_async_workflow())
        except Exception as e:
            print(f"[LiveAudio] Async loop crash: {traceback.format_exc()}")
            self.session_error.emit(f"Live voice session error: {e}")
        finally:
            self._cleanup_loop()
            self.session_closed.emit()

    def _cleanup_loop(self):
        try:
            pending = asyncio.all_tasks(self._loop)
            for task in pending:
                task.cancel()
            self._loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
            self._loop.close()
        except Exception:
            pass

    async def _main_async_workflow(self):
        """Core asynchronous live session orchestration."""
        if not self.api_key:
            self.session_error.emit("API key is not configured. Open Settings to enter your key.")
            return

        client = genai.Client(api_key=self.api_key)

        # Configure Live Connect parameters
        live_config = types.LiveConnectConfig(
            response_modalities=[types.LiveModality.AUDIO],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(
                        voice_name=self.voice_name
                    )
                )
            ),
            input_audio_transcription=types.AudioTranscriptionConfig(),
            output_audio_transcription=types.AudioTranscriptionConfig(),
            system_instruction="You are GeminiOverlay, an ultra-fast, helpful, and concise Windows AI desktop companion. Answer directly and naturally."
        )

        # Output sounddevice playback stream
        out_stream = sd.RawOutputStream(
            samplerate=24000,
            channels=1,
            dtype="int16",
            blocksize=512,
            device=self.output_device
        )
        out_stream.start()

        # Input microphone callback for sounddevice
        def audio_input_callback(indata, frames, time_info, status):
            if not self.running:
                return
            # Acoustic echo prevention: If AI is talking and user has no headphones, gate the mic
            if self.is_ai_speaking and not self.headphones_mode:
                return
            # Put bytes into asyncio queue
            raw_bytes = bytes(indata)
            if self._loop and self._loop.is_running():
                self._loop.call_soon_threadsafe(self.audio_in_queue.put_nowait, raw_bytes)

        in_stream = sd.RawInputStream(
            samplerate=16000,
            channels=1,
            dtype="int16",
            blocksize=512,
            device=self.input_device,
            callback=audio_input_callback
        )
        in_stream.start()
        self.state_changed.emit("Listening")

        try:
            # Connect to Gemini Live
            async with client.aio.live.connect(
                model=self.live_model,
                config=live_config
            ) as session:
                self._session = session
                print("[LiveAudio] Connected to Gemini Live session!")

                # Start concurrent sender and receiver tasks
                send_task = asyncio.create_task(self._send_audio_loop(session))
                recv_task = asyncio.create_task(self._recv_audio_loop(session, out_stream))
                screen_task = asyncio.create_task(self._screen_watch_loop(session))

                # Wait until stopped or an error occurs
                while self.running:
                    await asyncio.sleep(0.1)

                send_task.cancel()
                recv_task.cancel()
                screen_task.cancel()
                await asyncio.gather(send_task, recv_task, screen_task, return_exceptions=True)

        except Exception as e:
            err = str(e)
            print(f"[LiveAudio] Session exception: {traceback.format_exc()}")
            self.session_error.emit(f"Connection failed: {err}")
        finally:
            try:
                in_stream.stop()
                in_stream.close()
            except Exception:
                pass
            try:
                out_stream.stop()
                out_stream.close()
            except Exception:
                pass
            self.state_changed.emit("Idle")

    async def _send_audio_loop(self, session):
        """Streams microphone PCM chunks to the Live session."""
        while self.running:
            try:
                chunk = await self.audio_in_queue.get()
                if chunk:
                    # Send realtime audio PCM (16kHz mono)
                    await session.send_realtime_input(
                        audio=types.Blob(
                            data=chunk,
                            mime_type="audio/pcm;rate=16000"
                        )
                    )
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"[LiveAudio] Send error: {e}")
                break

    async def _screen_watch_loop(self, session):
        """Watches for screen capture triggers and injects JPEG frame into the session."""
        while self.running:
            try:
                await self.screen_frame_event.wait()
                self.screen_frame_event.clear()
                if self.pending_screen_frame and self.running:
                    frame_bytes = self.pending_screen_frame
                    self.pending_screen_frame = None
                    await session.send_realtime_input(
                        video=types.Blob(
                            data=frame_bytes,
                            mime_type="image/jpeg"
                        )
                    )
                    print("[LiveAudio] Screen frame sent to Gemini Live")
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"[LiveAudio] Screen watch error: {e}")

    async def _recv_audio_loop(self, session, out_stream: sd.RawOutputStream):
        """Receives model turns, handles barge-in interruptions, and plays 24kHz audio."""
        while self.running:
            try:
                async for response in session.receive():
                    server_content = response.server_content
                    if server_content is None:
                        continue

                    # Barge-in: if user spoke, model signals interruption
                    if server_content.interrupted:
                        print("[LiveAudio] Model interrupted by user barge-in! Aborting playback.")
                        self.is_ai_speaking = False
                        self.state_changed.emit("Listening")
                        continue

                    # Handle audio turns
                    model_turn = server_content.model_turn
                    if model_turn is not None:
                        for part in model_turn.parts:
                            # 1. Audio stream chunks
                            if hasattr(part, "inline_data") and part.inline_data:
                                audio_bytes = part.inline_data.data
                                if isinstance(audio_bytes, str):
                                    audio_bytes = base64.b64decode(audio_bytes)

                                if not self.is_ai_speaking:
                                    self.is_ai_speaking = True
                                    self.state_changed.emit("Speaking")

                                # Write directly to low latency output stream
                                out_stream.write(audio_bytes)

                            # 2. Model text transcriptions
                            if hasattr(part, "text") and part.text:
                                self.model_transcription.emit(part.text)

                    # Turn completed
                    if server_content.turn_complete:
                        self.is_ai_speaking = False
                        self.state_changed.emit("Listening")

            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"[LiveAudio] Receive error: {e}")
                break


# ==============================================================================
# 9. UI COMPONENTS (PROMPT EDIT & TITLEBAR)
# ==============================================================================

class PromptInputBox(QPlainTextEdit):
    """
    Custom text editor that sends on Enter and inserts a newline on Shift+Enter.
    """
    submit_requested = pyqtSignal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setPlaceholderText("Ask Gemini... (Enter to send, Shift+Enter for newline)")
        self.setMaximumHeight(120)
        self.setMinimumHeight(44)
        self.setStyleSheet("""
            QPlainTextEdit {
                background: rgba(18, 14, 34, 0.85);
                color: #f1f5f9;
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 12px;
                padding: 10px 14px;
                font-size: 13.5px;
                font-family: 'Segoe UI', -apple-system, sans-serif;
            }
            QPlainTextEdit:focus {
                border: 1px solid #9333ea;
                background: rgba(22, 16, 42, 0.95);
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
# 10. MAIN OVERLAY WINDOW (GLASSMORPHIC PYQT6)
# ==============================================================================

class GeminiOverlayWindow(QMainWindow):
    """
    Frameless, always-on-top, translucent floating window with purple-to-dark
    glassmorphism gradient card, 22px rounded corners, Segoe UI font,
    draggable title bar, and system tray integration.
    """
    def __init__(self, config_manager: ConfigManager, startup_manager: StartupManager):
        super().__init__()
        self.cfg = config_manager
        self.startup = startup_manager

        # Workers
        self.text_worker: Optional[GeminiTextWorker] = None
        self.tts_worker: Optional[TTSWorker] = None
        self.live_worker: Optional[LiveAudioSessionWorker] = None

        # State
        self.is_pinned = self.cfg.data.get("pin_active", False)
        self.is_voice_active = False
        self.current_response_text = ""

        # Setup Window Properties
        self.init_window_flags()
        self.init_ui()
        self.restore_saved_geometry()

    def init_window_flags(self):
        """Sets frameless, always-on-top, and translucent attributes."""
        self.setWindowFlags(
            Qt.WindowType.FramelessWindowHint |
            Qt.WindowType.WindowStaysOnTopHint |
            Qt.WindowType.Tool  # Tool prevents taskbar clutter
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        self.setMinimumSize(380, 500)
        self.resize(460, 640)

    def init_ui(self):
        """Builds modern glassmorphic card container."""
        # Outer wrapper with padding for drop shadow
        self.central_container = QWidget(self)
        self.setCentralWidget(self.central_container)
        outer_layout = QVBoxLayout(self.central_container)
        outer_layout.setContentsMargins(12, 12, 12, 12)

        # Main glassmorphic card
        self.card = QFrame(self.central_container)
        self.card.setObjectName("GlassCard")
        self.card.setStyleSheet("""
            #GlassCard {
                background: qlineargradient(
                    x1:0, y1:0, x2:1, y2:1,
                    stop:0 rgba(26, 18, 48, 0.94),
                    stop:0.45 rgba(15, 11, 30, 0.96),
                    stop:1 rgba(22, 14, 40, 0.95)
                );
                border: 1px solid rgba(255, 255, 255, 0.14);
                border-radius: 22px;
            }
        """)

        # Soft drop shadow
        shadow = QGraphicsDropShadowEffect(self.card)
        shadow.setBlurRadius(32)
        shadow.setColor(QColor(0, 0, 0, 180))
        shadow.setOffset(0, 8)
        self.card.setGraphicsEffect(shadow)

        card_layout = QVBoxLayout(self.card)
        card_layout.setContentsMargins(16, 14, 16, 16)
        card_layout.setSpacing(10)
        outer_layout.addWidget(self.card)

        # 1. Custom Title Bar
        self.build_titlebar(card_layout)

        # 2. Content Stack (Assistant Tab vs Settings Tab)
        self.stack = QStackedLayout()
        card_layout.addLayout(self.stack)

        self.tab_assistant = self.build_assistant_tab()
        self.tab_settings = self.build_settings_tab()
        self.stack.addWidget(self.tab_assistant)
        self.stack.addWidget(self.tab_settings)

        # 3. Bottom corner resize grip
        grip_layout = QHBoxLayout()
        grip_layout.addStretch()
        self.size_grip = QSizeGrip(self.card)
        self.size_grip.setStyleSheet("width: 16px; height: 16px;")
        grip_layout.addWidget(self.size_grip)
        card_layout.addLayout(grip_layout)

    def build_titlebar(self, parent_layout: QVBoxLayout):
        """Builds custom draggable titlebar with logo, tabs, pin, and minimize."""
        self.titlebar = QWidget(self.card)
        self.titlebar.setFixedHeight(38)
        tb_layout = QHBoxLayout(self.titlebar)
        tb_layout.setContentsMargins(4, 0, 4, 0)
        tb_layout.setSpacing(8)

        # Logo icon
        logo_label = QLabel()
        logo_label.setPixmap(create_gemini_icon(24).pixmap(24, 24))
        tb_layout.addWidget(logo_label)

        # App title
        app_title = QLabel("GeminiOverlay")
        app_title.setStyleSheet("color: #ffffff; font-weight: 700; font-size: 14px; font-family: 'Segoe UI';")
        tb_layout.addWidget(app_title)

        tb_layout.addSpacing(12)

        # Segmented Pill Tab Switcher
        pill_container = QFrame()
        pill_container.setStyleSheet("""
            QFrame {
                background: rgba(255, 255, 255, 0.08);
                border-radius: 12px;
                padding: 2px;
            }
        """)
        pill_layout = QHBoxLayout(pill_container)
        pill_layout.setContentsMargins(2, 2, 2, 2)
        pill_layout.setSpacing(2)

        self.btn_tab_assistant = QPushButton("Assistant")
        self.btn_tab_assistant.setCheckable(True)
        self.btn_tab_assistant.setChecked(True)
        self.btn_tab_assistant.clicked.connect(lambda: self.switch_tab(0))

        self.btn_tab_settings = QPushButton("Settings")
        self.btn_tab_settings.setCheckable(True)
        self.btn_tab_settings.setChecked(False)
        self.btn_tab_settings.clicked.connect(lambda: self.switch_tab(1))

        pill_style = """
            QPushButton {
                border: none;
                border-radius: 10px;
                padding: 4px 12px;
                color: #94a3b8;
                font-size: 11.5px;
                font-weight: 600;
                font-family: 'Segoe UI';
            }
            QPushButton:checked {
                background: rgba(147, 51, 234, 0.85);
                color: #ffffff;
            }
            QPushButton:hover:!checked {
                background: rgba(255, 255, 255, 0.06);
                color: #e2e8f0;
            }
        """
        self.btn_tab_assistant.setStyleSheet(pill_style)
        self.btn_tab_settings.setStyleSheet(pill_style)
        pill_layout.addWidget(self.btn_tab_assistant)
        pill_layout.addWidget(self.btn_tab_settings)
        tb_layout.addWidget(pill_container)

        tb_layout.addStretch()

        # Action button style
        action_btn_style = """
            QPushButton {
                background: transparent;
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 14px;
                width: 28px;
                height: 28px;
                color: #94a3b8;
                font-size: 12px;
                font-weight: bold;
            }
            QPushButton:hover {
                background: rgba(255, 255, 255, 0.12);
                color: #ffffff;
            }
        """

        # Pin toggle button
        self.btn_pin = QPushButton("📌")
        self.btn_pin.setToolTip("Pin window (prevents auto-hide when clicking outside)")
        self.btn_pin.setStyleSheet(action_btn_style)
        self.btn_pin.setCheckable(True)
        self.btn_pin.setChecked(self.is_pinned)
        self.update_pin_style()
        self.btn_pin.clicked.connect(self.toggle_pin)
        tb_layout.addWidget(self.btn_pin)

        # Minimize to tray button
        btn_min = QPushButton("—")
        btn_min.setToolTip("Minimize to system tray")
        btn_min.setStyleSheet(action_btn_style)
        btn_min.clicked.connect(self.hide_overlay)
        tb_layout.addWidget(btn_min)

        parent_layout.addWidget(self.titlebar)

    def mousePressEvent(self, event):
        """Allows window dragging by clicking and dragging on the custom title bar."""
        if event.button() == Qt.MouseButton.LeftButton and self.titlebar.underMouse():
            # Use native Windows startSystemMove() if available
            window_handle = self.windowHandle()
            if window_handle is not None and hasattr(window_handle, "startSystemMove"):
                window_handle.startSystemMove()
                event.accept()
                return
        super().mousePressEvent(event)

    def changeEvent(self, event):
        """Auto-hide when clicking outside if unpinned."""
        if event.type() == QEvent.Type.ActivationChange:
            if not self.isActiveWindow() and not self.is_pinned:
                # Give user 200ms grace period so child menus/popups don't accidentally close it
                QTimer.singleShot(150, self._check_auto_hide)
        super().changeEvent(event)

    def _check_auto_hide(self):
        if not self.isActiveWindow() and not self.is_pinned and not self.is_voice_active:
            self.hide_overlay()

    def keyPressEvent(self, event):
        """Esc hides the overlay."""
        if event.key() == Qt.Key.Key_Escape:
            self.hide_overlay()
            event.accept()
        else:
            super().keyPressEvent(event)

    def toggle_pin(self):
        self.is_pinned = self.btn_pin.isChecked()
        self.cfg.data["pin_active"] = self.is_pinned
        self.cfg.save()
        self.update_pin_style()

    def update_pin_style(self):
        if self.is_pinned:
            self.btn_pin.setStyleSheet("""
                QPushButton {
                    background: rgba(147, 51, 234, 0.4);
                    border: 1px solid #a855f7;
                    border-radius: 14px;
                    width: 28px;
                    height: 28px;
                    color: #ffffff;
                }
            """)
        else:
            self.btn_pin.setStyleSheet("""
                QPushButton {
                    background: transparent;
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 14px;
                    width: 28px;
                    height: 28px;
                    color: #94a3b8;
                }
            """)

    def switch_tab(self, index: int):
        self.stack.setCurrentIndex(index)
        self.btn_tab_assistant.setChecked(index == 0)
        self.btn_tab_settings.setChecked(index == 1)

    # --------------------------------------------------------------------------
    # Assistant Tab Layout
    # --------------------------------------------------------------------------

    def build_assistant_tab(self) -> QWidget:
        widget = QWidget()
        layout = QVBoxLayout(widget)
        layout.setContentsMargins(0, 6, 0, 0)
        layout.setSpacing(10)

        # 1. Chat & Response History (QTextBrowser)
        self.browser = QTextBrowser()
        self.browser.setOpenExternalLinks(True)
        self.browser.setStyleSheet("""
            QTextBrowser {
                background: rgba(14, 10, 26, 0.6);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 14px;
                padding: 12px;
                color: #e2e8f0;
                font-family: 'Segoe UI', -apple-system, sans-serif;
                font-size: 13px;
                line-height: 1.5;
            }
        """)
        # Initial greeting
        self.render_initial_welcome()
        layout.addWidget(self.browser, stretch=1)

        # 2. Status & "Thinking..." Indicator
        self.status_bar_widget = QWidget()
        status_layout = QHBoxLayout(self.status_bar_widget)
        status_layout.setContentsMargins(4, 0, 4, 0)
        status_layout.setSpacing(8)

        self.lbl_status = QLabel("")
        self.lbl_status.setStyleSheet("color: #a855f7; font-size: 12px; font-weight: 600;")
        status_layout.addWidget(self.lbl_status)

        self.spinner = QProgressBar()
        self.spinner.setMaximum(0)
        self.spinner.setMinimum(0)
        self.spinner.setFixedHeight(4)
        self.spinner.setTextVisible(False)
        self.spinner.setStyleSheet("""
            QProgressBar {
                background: rgba(255, 255, 255, 0.08);
                border-radius: 2px;
                border: none;
            }
            QProgressBar::chunk {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 #9333ea, stop:1 #3b82f6);
                border-radius: 2px;
            }
        """)
        self.spinner.hide()
        status_layout.addWidget(self.spinner, stretch=1)

        # Stop Voice/TTS button (shown only when audio is active)
        self.btn_stop_audio = QPushButton("Stop Voice ⏹")
        self.btn_stop_audio.setStyleSheet("""
            QPushButton {
                background: rgba(239, 68, 68, 0.2);
                border: 1px solid rgba(239, 68, 68, 0.4);
                border-radius: 8px;
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

        layout.addWidget(self.status_bar_widget)

        # 3. Input Text Box (Enter sends, Shift+Enter newline)
        self.prompt_edit = PromptInputBox()
        self.prompt_edit.submit_requested.connect(self.handle_send_text)
        layout.addWidget(self.prompt_edit)

        # 4. Action Buttons Bar
        btn_bar = QHBoxLayout()
        btn_bar.setSpacing(8)

        # Capture & Analyze Screen button
        self.btn_screen = QPushButton("📷 Analyze Screen")
        self.btn_screen.setToolTip("Hides overlay, grabs screen, and sends to Gemini vision")
        self.btn_screen.setStyleSheet("""
            QPushButton {
                background: rgba(255, 255, 255, 0.08);
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 12px;
                padding: 8px 14px;
                color: #e2e8f0;
                font-size: 12px;
                font-weight: 600;
                font-family: 'Segoe UI';
            }
            QPushButton:hover {
                background: rgba(255, 255, 255, 0.16);
                border-color: rgba(255, 255, 255, 0.2);
            }
        """)
        self.btn_screen.clicked.connect(self.handle_capture_screen)
        btn_bar.addWidget(self.btn_screen)

        btn_bar.addStretch()

        # Microphone Live Voice Button
        self.btn_mic = QPushButton("🎙")
        self.btn_mic.setToolTip("Toggle Two-Way Voice Conversation (Default hotkey: Ctrl+Shift+V)")
        self.btn_mic.setFixedSize(38, 38)
        self.update_mic_button_style(active=False)
        self.btn_mic.clicked.connect(self.toggle_voice_session)
        btn_bar.addWidget(self.btn_mic)

        # Gradient Send Button
        self.btn_send = QPushButton("Send ➤")
        self.btn_send.setStyleSheet("""
            QPushButton {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 #9333ea, stop:1 #4f46e5);
                border: none;
                border-radius: 12px;
                padding: 8px 18px;
                color: #ffffff;
                font-size: 12.5px;
                font-weight: 600;
                font-family: 'Segoe UI';
            }
            QPushButton:hover {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 #a855f7, stop:1 #6366f1);
            }
            QPushButton:pressed {
                background: #7e22ce;
            }
        """)
        self.btn_send.clicked.connect(self.handle_send_text)
        btn_bar.addWidget(self.btn_send)

        layout.addLayout(btn_bar)
        return widget

    def update_mic_button_style(self, active: bool):
        if active:
            self.btn_mic.setStyleSheet("""
                QPushButton {
                    background: qradialgradient(cx:0.5, cy:0.5, radius:0.6, fx:0.5, fy:0.5, stop:0 #ef4444, stop:1 #b91c1c);
                    border: 2px solid #fca5a5;
                    border-radius: 19px;
                    color: #ffffff;
                    font-size: 15px;
                }
                QPushButton:hover {
                    background: #dc2626;
                }
            """)
        else:
            self.btn_mic.setStyleSheet("""
                QPushButton {
                    background: rgba(255, 255, 255, 0.08);
                    border: 1px solid rgba(255, 255, 255, 0.15);
                    border-radius: 19px;
                    color: #c084fc;
                    font-size: 15px;
                }
                QPushButton:hover {
                    background: rgba(147, 51, 234, 0.25);
                    border-color: #a855f7;
                    color: #ffffff;
                }
            """)

    def render_initial_welcome(self):
        welcome_html = """
        <div style="text-align: center; padding: 24px 8px;">
            <div style="font-size: 18px; font-weight: bold; color: #c084fc; margin-bottom: 6px;">
                GeminiOverlay
            </div>
            <div style="font-size: 12px; color: #94a3b8; margin-bottom: 16px;">
                Fast, system-wide AI assistant with live voice conversation
            </div>
            <div style="text-align: left; background: rgba(255,255,255,0.04); border-radius: 10px; padding: 12px; font-size: 12px; color: #cbd5e1;">
                • Press <b>Ctrl+Shift+Space</b> to summon or dismiss anywhere.<br>
                • Press <b>Ctrl+Shift+V</b> or click 🎙️ for instant two-way voice chat.<br>
                • Click <b>📷 Analyze Screen</b> to analyze windows, graphs, or code.<br>
                • Configure your API key in the <b>Settings</b> tab above.
            </div>
        </div>
        """
        self.browser.setHtml(welcome_html)

    # --------------------------------------------------------------------------
    # Settings Tab Layout
    # --------------------------------------------------------------------------

    def build_settings_tab(self) -> QWidget:
        widget = QWidget()
        layout = QVBoxLayout(widget)
        layout.setContentsMargins(4, 6, 4, 0)
        layout.setSpacing(12)

        form_style = """
            QLabel {
                color: #cbd5e1;
                font-size: 12px;
                font-weight: 600;
                font-family: 'Segoe UI';
            }
            QLineEdit, QComboBox, QKeySequenceEdit {
                background: rgba(18, 14, 34, 0.85);
                color: #f1f5f9;
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 8px;
                padding: 6px 10px;
                font-size: 12px;
                font-family: 'Segoe UI';
            }
            QLineEdit:focus, QComboBox:focus, QKeySequenceEdit:focus {
                border: 1px solid #9333ea;
            }
            QCheckBox {
                color: #e2e8f0;
                font-size: 12px;
                font-family: 'Segoe UI';
                spacing: 8px;
            }
            QCheckBox::indicator {
                width: 16px;
                height: 16px;
                border-radius: 4px;
                border: 1px solid rgba(255, 255, 255, 0.2);
                background: rgba(18, 14, 34, 0.85);
            }
            QCheckBox::indicator:checked {
                background: #9333ea;
                border-color: #a855f7;
            }
        """
        widget.setStyleSheet(form_style)

        # 1. API Key Field (DPAPI Encrypted at rest)
        lbl_key = QLabel("Gemini API Key (Encrypted at rest with Windows DPAPI):")
        layout.addWidget(lbl_key)

        key_box = QHBoxLayout()
        self.edit_api_key = QLineEdit()
        self.edit_api_key.setEchoMode(QLineEdit.EchoMode.Password)
        self.edit_api_key.setPlaceholderText("Paste your Gemini API key (AIzaSy...)")
        self.edit_api_key.setText(self.cfg.get_api_key())
        key_box.addWidget(self.edit_api_key)

        self.btn_show_key = QPushButton("👁")
        self.btn_show_key.setFixedWidth(32)
        self.btn_show_key.setStyleSheet("""
            QPushButton {
                background: rgba(255, 255, 255, 0.08);
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 8px;
                color: #e2e8f0;
                padding: 4px;
            }
        """)
        self.btn_show_key.clicked.connect(self.toggle_api_key_visibility)
        key_box.addWidget(self.btn_show_key)
        layout.addLayout(key_box)

        # 2. Text/Vision Model Dropdown (Active Free API Tier Models)
        lbl_model = QLabel("Text & Vision Model:")
        layout.addWidget(lbl_model)
        self.cb_model = QComboBox()
        # Active free API tier models
        free_models = [
            "gemini-3.8-flash",       # Free Tier Flagship (Text, Code, Vision)
            "gemini-3.1-flash-lite",  # Free Tier Ultra-Fast (Low Latency)
            "gemini-flash-latest",    # Free Tier (Tracks Latest Stable Flash)
        ]
        self.cb_model.addItems(free_models)
        self.cb_model.setEditable(True)  # Allows entering any custom model identifier
        current_model = self.cfg.data.get("model", "gemini-3.8-flash")
        idx = self.cb_model.findText(current_model)
        if idx >= 0:
            self.cb_model.setCurrentIndex(idx)
        else:
            self.cb_model.setEditText(current_model)
        layout.addWidget(self.cb_model)

        # 3. Hotkey configuration
        hotkeys_layout = QHBoxLayout()

        # Show/Hide Hotkey
        col1 = QVBoxLayout()
        col1.addWidget(QLabel("Show / Hide Hotkey:"))
        self.edit_hotkey_toggle = QKeySequenceEdit(QKeySequence(self.cfg.data.get("hotkey_toggle", "Ctrl+Shift+Space")))
        col1.addWidget(self.edit_hotkey_toggle)
        hotkeys_layout.addLayout(col1)

        # Voice Chat Hotkey
        col2 = QVBoxLayout()
        col2.addWidget(QLabel("Voice Chat Hotkey:"))
        self.edit_hotkey_voice = QKeySequenceEdit(QKeySequence(self.cfg.data.get("hotkey_voice", "Ctrl+Shift+V")))
        col2.addWidget(self.edit_hotkey_voice)
        hotkeys_layout.addLayout(col2)

        layout.addLayout(hotkeys_layout)

        # 4. Voice Configuration (Voice persona + devices)
        voice_row = QHBoxLayout()

        # Voice selection
        v_col1 = QVBoxLayout()
        v_col1.addWidget(QLabel("AI Voice Persona:"))
        self.cb_voice = QComboBox()
        self.cb_voice.addItems(["Puck", "Charon", "Kore", "Fenrir", "Aoede", "Zephyr"])
        cur_voice = self.cfg.data.get("voice_name", "Puck")
        v_idx = self.cb_voice.findText(cur_voice)
        if v_idx >= 0:
            self.cb_voice.setCurrentIndex(v_idx)
        v_col1.addWidget(self.cb_voice)
        voice_row.addLayout(v_col1)

        # Input device dropdown
        v_col2 = QVBoxLayout()
        v_col2.addWidget(QLabel("Microphone Device:"))
        self.cb_input_device = QComboBox()
        self.populate_audio_devices(self.cb_input_device, is_input=True)
        voice_row.addLayout(v_col2)
        layout.addLayout(voice_row)

        # Output device dropdown
        lbl_out_dev = QLabel("Speaker / Output Device:")
        layout.addWidget(lbl_out_dev)
        self.cb_output_device = QComboBox()
        self.populate_audio_devices(self.cb_output_device, is_input=False)
        layout.addWidget(self.cb_output_device)

        # 5. Checkboxes (Startup, TTS, Headphones)
        self.chk_startup = QCheckBox("Start with Windows (launch automatically into system tray)")
        self.chk_startup.setChecked(self.startup.is_enabled())
        layout.addWidget(self.chk_startup)

        self.chk_speak_typed = QCheckBox("Speak typed answers aloud (Gemini TTS)")
        self.chk_speak_typed.setChecked(self.cfg.data.get("speak_typed_answers", False))
        layout.addWidget(self.chk_speak_typed)

        self.chk_headphones = QCheckBox("I'm using headphones (allow interruptions / ungate mic)")
        self.chk_headphones.setChecked(self.cfg.data.get("headphones_mode", False))
        layout.addWidget(self.chk_headphones)

        layout.addStretch()

        # 6. Save Button and Status
        save_box = QHBoxLayout()
        self.lbl_save_status = QLabel("")
        self.lbl_save_status.setStyleSheet("color: #4ade80; font-size: 12px; font-weight: bold;")
        save_box.addWidget(self.lbl_save_status)
        save_box.addStretch()

        self.btn_save = QPushButton("Save Settings")
        self.btn_save.setStyleSheet("""
            QPushButton {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 #9333ea, stop:1 #4f46e5);
                border: none;
                border-radius: 10px;
                padding: 8px 20px;
                color: #ffffff;
                font-weight: 600;
                font-size: 12.5px;
            }
            QPushButton:hover {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 #a855f7, stop:1 #6366f1);
            }
        """)
        self.btn_save.clicked.connect(self.save_settings)
        save_box.addWidget(self.btn_save)
        layout.addLayout(save_box)

        return widget

    def populate_audio_devices(self, combobox: QComboBox, is_input: bool):
        """Populates audio devices using sounddevice.query_devices()."""
        combobox.clear()
        combobox.addItem("System Default", None)
        try:
            devices = sd.query_devices()
            for idx, dev in enumerate(devices):
                channels = dev["max_input_channels"] if is_input else dev["max_output_channels"]
                if channels > 0:
                    name = f"{dev['name']} (#{idx})"
                    combobox.addItem(name, idx)
        except Exception as e:
            print(f"[UI] Error querying audio devices: {e}")

    def toggle_api_key_visibility(self):
        if self.edit_api_key.echoMode() == QLineEdit.EchoMode.Password:
            self.edit_api_key.setEchoMode(QLineEdit.EchoMode.Normal)
            self.btn_show_key.setText("🔒")
        else:
            self.edit_api_key.setEchoMode(QLineEdit.EchoMode.Password)
            self.btn_show_key.setText("👁")

    def save_settings(self):
        """Saves settings, encrypts key via DPAPI, updates registry, and rebinds hotkeys."""
        # 1. API Key
        raw_key = self.edit_api_key.text().strip()
        self.cfg.set_api_key(raw_key)

        # 2. Model & Voice
        self.cfg.data["model"] = self.cb_model.currentText()
        self.cfg.data["voice_name"] = self.cb_voice.currentText()

        # 3. Devices
        self.cfg.data["input_device"] = self.cb_input_device.currentData()
        self.cfg.data["output_device"] = self.cb_output_device.currentData()

        # 4. Checkboxes
        self.cfg.data["speak_typed_answers"] = self.chk_speak_typed.isChecked()
        self.cfg.data["headphones_mode"] = self.chk_headphones.isChecked()

        # 5. Startup registry
        enable_startup = self.chk_startup.isChecked()
        self.cfg.data["start_with_windows"] = enable_startup
        self.startup.set_enabled(enable_startup)

        # 6. Hotkeys
        new_toggle = self.edit_hotkey_toggle.keySequence().toString()
        new_voice = self.edit_hotkey_voice.keySequence().toString()
        if new_toggle:
            self.cfg.data["hotkey_toggle"] = new_toggle
        if new_voice:
            self.cfg.data["hotkey_voice"] = new_voice

        # Persist to disk
        self.cfg.save()

        # Re-bind global hotkeys live
        global_app = QApplication.instance()
        if hasattr(global_app, "hotkey_manager"):
            global_app.hotkey_manager.update_hotkeys(
                self.cfg.data["hotkey_toggle"],
                self.cfg.data["hotkey_voice"]
            )

        # Show confirmation feedback
        self.lbl_save_status.setText("✓ Settings saved successfully!")
        QTimer.singleShot(2500, lambda: self.lbl_save_status.setText(""))

    # --------------------------------------------------------------------------
    # Text Chat & Vision Handling
    # --------------------------------------------------------------------------

    def handle_send_text(self):
        prompt = self.prompt_edit.toPlainText().strip()
        if not prompt:
            return

        self.prompt_edit.clear()
        self.append_user_message(prompt)
        self.execute_gemini_query(prompt, image=None)

    def handle_capture_screen(self):
        """Hides overlay briefly to capture pristine screen, restores, and queries."""
        prompt = self.prompt_edit.toPlainText().strip()
        self.prompt_edit.clear()

        # If live voice session is active, inject frame directly into live stream
        if self.is_voice_active and self.live_worker:
            self.append_user_message("[Look at my screen 📷]")
            self.live_worker.trigger_screen_analysis()
            return

        # Regular vision query
        self.hide()
        QApplication.processEvents()
        time.sleep(0.2)  # Allow compositor to update

        try:
            screenshot = ImageGrab.grab()
        except Exception as e:
            self.show_overlay()
            self.append_error(f"Screen capture failed: {e}")
            return

        self.show_overlay()
        msg_header = f"[Captured Screen 📷] {prompt}" if prompt else "[Captured Screen 📷]"
        self.append_user_message(msg_header)
        self.execute_gemini_query(prompt, image=screenshot)

    def execute_gemini_query(self, prompt: str, image: Optional[Image.Image] = None):
        api_key = self.cfg.get_api_key()
        if not api_key:
            self.append_error("No API Key detected. Please open Settings and enter your Gemini API key.")
            self.switch_tab(1)
            return

        # Prepare UI for response streaming
        self.lbl_status.setText("Thinking...")
        self.spinner.show()
        self.btn_send.setEnabled(False)
        self.btn_screen.setEnabled(False)
        self.current_response_text = ""

        # Prepare AI response placeholder
        self.append_ai_response_placeholder()

        # Start background worker
        model = self.cfg.data.get("model", "gemini-3.8-flash")
        self.text_worker = GeminiTextWorker(api_key, model, prompt, image)
        self.text_worker.chunk_received.connect(self.on_chunk_received)
        self.text_worker.finished.connect(self.on_query_finished)
        self.text_worker.error.connect(self.on_query_error)
        self.text_worker.start()

    @pyqtSlot(str)
    def on_chunk_received(self, chunk: str):
        self.current_response_text += chunk
        self.update_streaming_ai_response(self.current_response_text)

    @pyqtSlot(str)
    def on_query_finished(self, full_text: str):
        self.lbl_status.setText("")
        self.spinner.hide()
        self.btn_send.setEnabled(True)
        self.btn_screen.setEnabled(True)
        self.update_streaming_ai_response(full_text, is_complete=True)

        # If Speak typed answers is enabled, read aloud
        if self.cfg.data.get("speak_typed_answers", False) and full_text.strip():
            self.speak_text_aloud(full_text)

    @pyqtSlot(str)
    def on_query_error(self, err_msg: str):
        self.lbl_status.setText("")
        self.spinner.hide()
        self.btn_send.setEnabled(True)
        self.btn_screen.setEnabled(True)
        self.append_error(err_msg)

    def speak_text_aloud(self, text: str):
        """Triggers TTS Worker for typed responses."""
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

    # --------------------------------------------------------------------------
    # HTML Chat Rendering Utilities
    # --------------------------------------------------------------------------

    def append_user_message(self, text: str):
        # Escape HTML entities
        import html
        escaped = html.escape(text).replace("\n", "<br>")
        user_html = f"""
        <div style="margin: 12px 0 6px 0; text-align: right;">
            <div style="display: inline-block; background: rgba(147, 51, 234, 0.25); border: 1px solid rgba(168, 85, 247, 0.4); border-radius: 12px; padding: 8px 14px; color: #f8fafc; font-size: 13px; text-align: left; max-width: 85%;">
                <b>You:</b> {escaped}
            </div>
        </div>
        """
        self.browser.append(user_html)
        self.scroll_to_bottom()

    def append_ai_response_placeholder(self):
        ai_html = """
        <div style="margin: 6px 0 12px 0; text-align: left;">
            <div style="color: #c084fc; font-weight: bold; font-size: 12px; margin-bottom: 4px;">Gemini:</div>
            <div id="ai_streaming_block" style="color: #e2e8f0; font-size: 13px; line-height: 1.5;">
                <span style="color: #94a3b8; font-style: italic;">...</span>
            </div>
        </div>
        """
        self.browser.append(ai_html)
        self.scroll_to_bottom()

    def update_streaming_ai_response(self, text: str, is_complete: bool = False):
        import html
        # Basic markdown code block and bold formatting
        formatted = html.escape(text)
        # Format code blocks ```code```
        import re
        formatted = re.sub(
            r"```(.*?)```",
            r"<pre style='background: #110d22; border: 1px solid #3b2d64; border-radius: 8px; padding: 8px; color: #38bdf8; font-family: Consolas, monospace;'>\1</pre>",
            formatted,
            flags=re.DOTALL
        )
        formatted = re.sub(r"`([^`]+)`", r"<code style='background: #1e1638; padding: 2px 4px; border-radius: 4px; color: #f472b6;'>\1</code>", formatted)
        formatted = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", formatted)
        formatted = formatted.replace("\n", "<br>")

        cursor = '<span style="color: #a855f7;">▌</span>' if not is_complete else ""
        content_html = f"<div style='margin-bottom: 8px;'>{formatted}{cursor}</div>"

        # Append chunk cleanly
        self.browser.insertHtml(content_html)
        self.scroll_to_bottom()

    def append_error(self, err_text: str):
        import html
        escaped = html.escape(err_text)
        err_html = f"""
        <div style="margin: 8px 0; background: rgba(239, 68, 68, 0.15); border-left: 3px solid #ef4444; padding: 8px 12px; border-radius: 6px; color: #fca5a5; font-size: 12.5px;">
            <b>Error:</b> {escaped}
        </div>
        """
        self.browser.append(err_html)
        self.scroll_to_bottom()

    def scroll_to_bottom(self):
        scrollbar = self.browser.verticalScrollBar()
        scrollbar.setValue(scrollbar.maximum())

    # --------------------------------------------------------------------------
    # Live Voice Mode Handling
    # --------------------------------------------------------------------------

    def toggle_voice_session(self):
        """Starts or stops the bidirectional Gemini Live voice session."""
        if self.is_voice_active:
            self.end_voice_session()
        else:
            self.start_voice_session()

    def start_voice_session(self):
        api_key = self.cfg.get_api_key()
        if not api_key:
            self.append_error("Please configure your Gemini API Key in Settings first.")
            self.switch_tab(1)
            return

        self.is_voice_active = True
        self.update_mic_button_style(active=True)
        self.lbl_status.setText("Connecting Live...")
        self.btn_stop_audio.show()

        live_model = self.cfg.data.get("live_model", "gemini-3.8-live")
        voice_name = self.cfg.data.get("voice_name", "Puck")
        in_dev = self.cfg.data.get("input_device")
        out_dev = self.cfg.data.get("output_device")
        headphones = self.cfg.data.get("headphones_mode", False)

        self.live_worker = LiveAudioSessionWorker(
            api_key=api_key,
            live_model=live_model,
            voice_name=voice_name,
            input_device=in_dev,
            output_device=out_dev,
            headphones_mode=headphones
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
        self.append_user_message(f"[Voice] {text}")

    @pyqtSlot(str)
    def on_live_model_transcription(self, text: str):
        self.update_streaming_ai_response(text, is_complete=True)

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

    # --------------------------------------------------------------------------
    # Window Visibility & Placement
    # --------------------------------------------------------------------------

    def toggle_overlay(self):
        if self.isVisible():
            self.hide_overlay()
        else:
            self.show_overlay()

    def show_overlay(self):
        self.show()
        self.raise_()
        self.activateWindow()
        force_activate_window(int(self.winId()))
        self.prompt_edit.setFocus()

    def hide_overlay(self):
        # Save geometry before hiding
        self.save_geometry()
        self.hide()

    def save_geometry(self):
        rect = self.geometry()
        self.cfg.data["window_geometry"] = {
            "x": rect.x(),
            "y": rect.y(),
            "width": rect.width(),
            "height": rect.height()
        }
        self.cfg.save()

    def restore_saved_geometry(self):
        """Restores saved window position and validates against active screens."""
        geom = self.cfg.data.get("window_geometry", {})
        x = geom.get("x", -1)
        y = geom.get("y", -1)
        w = geom.get("width", 460)
        h = geom.get("height", 640)

        # Check if saved position lies within any connected screen
        screens = QGuiApplication.screens()
        is_valid = False
        for screen in screens:
            if screen.geometry().contains(QPoint(x, y)):
                is_valid = True
                break

        if is_valid and x >= 0 and y >= 0:
            self.setGeometry(x, y, w, h)
        else:
            # Center on primary screen
            primary = QGuiApplication.primaryScreen()
            if primary:
                avail = primary.availableGeometry()
                cx = avail.x() + (avail.width() - w) // 2
                cy = avail.y() + (avail.height() - h) // 2
                self.setGeometry(cx, cy, w, h)

    def closeEvent(self, event):
        """Ensure threads and listeners terminate cleanly."""
        self.save_geometry()
        if self.live_worker:
            self.live_worker.stop_session()
        event.accept()


# ==============================================================================
# 11. SYSTEM TRAY MANAGER
# ==============================================================================

class SystemTrayManager(QObject):
    """
    Manages PyQt6 QSystemTrayIcon (avoids secondary GUI loops like pystray).
    Provides quick menu actions: Open Overlay, Settings, Toggle Startup, and Clean Exit.
    """
    def __init__(self, overlay: GeminiOverlayWindow, startup: StartupManager):
        super().__init__()
        self.overlay = overlay
        self.startup = startup

        self.tray_icon = QSystemTrayIcon(create_gemini_icon(32), overlay)
        self.tray_icon.setToolTip("GeminiOverlay - AI Desktop Assistant")

        # Context menu
        self.menu = QMenu()
        self.menu.setStyleSheet("""
            QMenu {
                background: #171228;
                border: 1px solid rgba(255, 255, 255, 0.15);
                border-radius: 8px;
                padding: 4px;
                color: #e2e8f0;
                font-family: 'Segoe UI';
            }
            QMenu::item {
                padding: 6px 20px;
                border-radius: 4px;
            }
            QMenu::item:selected {
                background: #9333ea;
                color: #ffffff;
            }
        """)

        # Open Overlay
        self.act_open = QAction("Open Overlay", self)
        self.act_open.triggered.connect(self.overlay.show_overlay)
        self.menu.addAction(self.act_open)

        # Settings
        self.act_settings = QAction("Settings", self)
        self.act_settings.triggered.connect(self.open_settings)
        self.menu.addAction(self.act_settings)

        self.menu.addSeparator()

        # Toggle Startup
        self.act_startup = QAction("Start with Windows", self)
        self.act_startup.setCheckable(True)
        self.act_startup.setChecked(self.startup.is_enabled())
        self.act_startup.triggered.connect(self.toggle_startup)
        self.menu.addAction(self.act_startup)

        self.menu.addSeparator()

        # Clean Exit
        self.act_exit = QAction("Exit GeminiOverlay", self)
        self.act_exit.triggered.connect(self.clean_exit)
        self.menu.addAction(self.act_exit)

        self.tray_icon.setContextMenu(self.menu)
        self.tray_icon.activated.connect(self.on_tray_activated)
        self.tray_icon.show()

    def on_tray_activated(self, reason: QSystemTrayIcon.ActivationReason):
        if reason == QSystemTrayIcon.ActivationReason.Trigger:
            self.overlay.toggle_overlay()

    def open_settings(self):
        self.overlay.show_overlay()
        self.overlay.switch_tab(1)

    def toggle_startup(self, checked: bool):
        self.startup.set_enabled(checked)
        self.overlay.chk_startup.setChecked(checked)
        self.overlay.cfg.data["start_with_windows"] = checked
        self.overlay.cfg.save()

    def clean_exit(self):
        self.overlay.save_geometry()
        if self.overlay.live_worker:
            self.overlay.live_worker.stop_session()

        app = QApplication.instance()
        if hasattr(app, "hotkey_manager"):
            app.hotkey_manager.stop_listener()

        self.tray_icon.hide()
        QApplication.quit()


# ==============================================================================
# 12. SINGLE-INSTANCE LOCK & MAIN ENTRY POINT
# ==============================================================================

def main():
    # 1. High DPI Awareness
    try:
        QApplication.setHighDpiScaleFactorRoundingPolicy(
            Qt.HighDpiScaleFactorRoundingPolicy.PassThrough
        )
    except Exception:
        pass

    app = QApplication(sys.argv)
    app.setQuitOnLastWindowClosed(False)  # Keep running in system tray

    # 2. Enforce Single-Instance via QLockFile
    lock_path = os.path.join(QDir.tempPath(), "GeminiOverlay.lock")
    lock_file = QLockFile(lock_path)
    if not lock_file.tryLock(100):
        print("[Instance] Another instance of GeminiOverlay is already active. Exiting.")
        sys.exit(0)

    # 3. Initialize Managers
    cfg_manager = ConfigManager()
    startup_manager = StartupManager()

    # 4. Initialize Overlay Window & System Tray
    overlay_window = GeminiOverlayWindow(cfg_manager, startup_manager)
    tray_manager = SystemTrayManager(overlay_window, startup_manager)

    # 5. Initialize Global Hotkey Manager
    toggle_hotkey = cfg_manager.data.get("hotkey_toggle", "Ctrl+Shift+Space")
    voice_hotkey = cfg_manager.data.get("hotkey_voice", "Ctrl+Shift+V")

    hotkey_manager = GlobalHotkeyManager(toggle_hotkey, voice_hotkey)
    hotkey_manager.toggle_requested.connect(overlay_window.toggle_overlay)
    hotkey_manager.voice_requested.connect(overlay_window.toggle_voice_session)

    # Attach to application object for global access
    app.hotkey_manager = hotkey_manager
    app.tray_manager = tray_manager

    # Show overlay initially on first launch
    overlay_window.show_overlay()

    # 6. Execute Application Event Loop
    exit_code = app.exec()

    # Release lock on termination
    lock_file.unlock()
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
