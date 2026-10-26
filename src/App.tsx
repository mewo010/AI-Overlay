import React, { useState, useEffect, useRef } from 'react';
import {
  Terminal,
  FileCode,
  Github,
  Play,
  Copy,
  Check,
  Download,
  ExternalLink,
  Mic,
  MicOff,
  Camera,
  Send,
  Pin,
  Minus,
  Sparkles,
  Volume2,
  VolumeX,
  Shield,
  Layers,
  Cpu,
  Monitor,
  Settings,
  AlertTriangle,
  Info,
  ChevronRight,
  Maximize2
} from 'lucide-react';

// Code contents for the 3 deliverables
const REQUIREMENTS_TXT = `# GeminiOverlay - Python Dependencies
# Compatible with Python 3.10, 3.11, and 3.12 on Windows 10/11 (64-bit)

# Official Google GenAI SDK (supports Gemini 2.5/3.8 and Gemini Live API)
google-genai>=2.4.0

# Desktop GUI Framework (Qt6)
PyQt6>=6.6.0
PyQt6-Qt6>=6.6.0

# Global system hotkeys
pynput>=1.7.7

# Screen capture and image processing
Pillow>=10.2.0

# Windows Win32 APIs (DPAPI encryption, window foreground focus, registry, winreg)
pywin32>=306

# Real-time microphone capture and low-latency audio playback
sounddevice>=0.4.6

# High-performance audio buffer manipulation
numpy>=1.26.0

# Windows standalone executable packaging
pyinstaller>=6.5.0
`;

const GITHUB_WORKFLOW_YML = `name: Build & Release GeminiOverlay

on:
  push:
    branches:
      - main
      - master
    tags:
      - 'v*.*.*'
  pull_request:
    branches:
      - main
  workflow_dispatch:
    inputs:
      create_release:
        description: 'Publish as GitHub Release?'
        type: boolean
        required: false
        default: true
      tag_name:
        description: 'Release tag name (e.g. v1.0.0)'
        type: string
        required: false
        default: 'v1.0.0'

permissions:
  contents: write

jobs:
  build:
    name: Build Standalone Windows Executable
    runs-on: windows-latest

    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Set up Python 3.12
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'
          cache: 'pip'

      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip setuptools wheel
          pip install -r requirements.txt

      - name: Package with PyInstaller
        shell: pwsh
        run: |
          pyinstaller \`
            --noconsole \`
            --onefile \`
            --name GeminiOverlay \`
            --clean \`
            --hidden-import pynput.keyboard._win32 \`
            --hidden-import pynput.mouse._win32 \`
            --collect-submodules google.genai \`
            --collect-submodules sounddevice \`
            --collect-data sounddevice \`
            --collect-binaries sounddevice \`
            main.py

      - name: Verify Executable Creation
        shell: pwsh
        run: |
          if (Test-Path "dist\\GeminiOverlay.exe") {
            $size = (Get-Item "dist\\GeminiOverlay.exe").Length / 1MB
            Write-Host "Success: dist\\GeminiOverlay.exe created ($([math]::Round($size, 2)) MB)"
            # Compute SHA256 for release checksums
            Get-FileHash -Algorithm SHA256 "dist\\GeminiOverlay.exe" | Out-File "dist\\checksums.sha256"
            Get-Content "dist\\checksums.sha256"
          } else {
            Write-Error "dist\\GeminiOverlay.exe not found!"
            exit 1
          }

      - name: Upload Build Artifact
        uses: actions/upload-artifact@v4
        with:
          name: GeminiOverlay-windows-x64
          path: |
            dist/GeminiOverlay.exe
            dist/checksums.sha256
          retention-days: 14

  release:
    name: Publish GitHub Release
    needs: build
    runs-on: ubuntu-latest
    if: |
      always() &&
      needs.build.result == 'success' &&
      (
        startsWith(github.ref, 'refs/tags/v') ||
        (github.event_name == 'workflow_dispatch' && inputs.create_release == true)
      )

    steps:
      - name: Download Build Artifact
        uses: actions/download-artifact@v4
        with:
          name: GeminiOverlay-windows-x64
          path: dist

      - name: Publish Release with Assets
        uses: softprops/action-gh-release@v2
        with:
          tag_name: \${{ startsWith(github.ref, 'refs/tags/v') && github.ref_name || inputs.tag_name || 'v1.0.0' }}
          name: \${{ startsWith(github.ref, 'refs/tags/v') && github.ref_name || inputs.tag_name || 'v1.0.0' }}
          files: |
            dist/GeminiOverlay.exe
            dist/checksums.sha256
          draft: false
          prerelease: false
          generate_release_notes: true
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`;

export default function App() {
  const [activeTab, setActiveTab] = useState<'simulator' | 'code' | 'docs'>('simulator');
  const [selectedFile, setSelectedFile] = useState<'main.py' | 'requirements.txt' | 'build-release.yml'>('main.py');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Simulator State
  const [simVisible, setSimVisible] = useState(true);
  const [simTab, setSimTab] = useState<'assistant' | 'settings'>('assistant');
  const [simPinned, setSimPinned] = useState(false);
  const [simVoiceActive, setSimVoiceActive] = useState(false);
  const [simVoiceState, setSimVoiceState] = useState<'Listening' | 'Thinking' | 'Speaking' | 'Idle'>('Idle');
  const [simMessages, setSimMessages] = useState<Array<{ sender: 'user' | 'gemini'; text: string; isVision?: boolean }>>([
    {
      sender: 'gemini',
      text: 'GeminiOverlay is ready. Press **Ctrl+Shift+Space** anywhere on Windows to toggle, or **Ctrl+Shift+V** for instant two-way voice chat. How can I help you right now?'
    }
  ]);
  const [simInput, setSimInput] = useState('');
  const [simStreaming, setSimStreaming] = useState(false);
  const [trayMenuOpen, setTrayMenuOpen] = useState(false);
  const [simStartupEnabled, setSimStartupEnabled] = useState(true);
  const [simHeadphonesMode, setSimHeadphonesMode] = useState(false);
  const [simSelectedVoice, setSimSelectedVoice] = useState('Puck');
  const [simModel, setSimModel] = useState('gemini-2.5-flash');
  const [simApiKey, setSimApiKey] = useState('AIzaSyD...•[DPAPI Encrypted]');
  const [simSavedFeedback, setSimSavedFeedback] = useState(false);

  // Dragging simulator window
  const [simPos, setSimPos] = useState({ x: 120, y: 50 });
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleDownloadFile = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Simulated Voice Conversation Loop
  useEffect(() => {
    let interval: any;
    if (simVoiceActive) {
      setSimVoiceState('Listening');
      interval = setInterval(() => {
        setSimVoiceState(prev => {
          if (prev === 'Listening') return 'Thinking';
          if (prev === 'Thinking') {
            setSimMessages(m => [
              ...m,
              { sender: 'user', text: '[Voice Input] Can you summarize the open issues on this monitor?' },
              { sender: 'gemini', text: "I've reviewed your active workspace: you have 3 open pull requests ready for merge and all CI tests passed." }
            ]);
            return 'Speaking';
          }
          if (prev === 'Speaking') return 'Listening';
          return 'Listening';
        });
      }, 4000);
    } else {
      setSimVoiceState('Idle');
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [simVoiceActive]);

  // Handle typing send in simulator
  const handleSimSend = () => {
    if (!simInput.trim() || simStreaming) return;
    const prompt = simInput.trim();
    setSimInput('');
    setSimMessages(prev => [...prev, { sender: 'user', text: prompt }]);
    setSimStreaming(true);

    setTimeout(() => {
      setSimMessages(prev => [
        ...prev,
        {
          sender: 'gemini',
          text: `Executing on Windows via \`${simModel}\`:\n\n\`\`\`powershell\n# Live response streamed through QThread to PyQt6\nGet-Process | Where-Object WorkingSet -gt 200MB | Select-Object Name, WS\n\`\`\`\n\nI have retrieved the system metrics. Would you like me to analyze memory trends or monitor CPU spikes?`
        }
      ]);
      setSimStreaming(false);
    }, 1200);
  };

  // Handle screen capture in simulator
  const handleSimScreenCapture = () => {
    setSimVisible(false);
    setTimeout(() => {
      setSimVisible(true);
      setSimMessages(prev => [
        ...prev,
        { sender: 'user', text: '[Captured Active Screen 📷]', isVision: true },
        {
          sender: 'gemini',
          text: 'Screen capture analyzed (1920x1080): Detected a code editor open with `main.py` and GitHub Actions workflow. The sounddevice PortAudio buffer is properly configured at 16kHz mono capture and 24kHz output.'
        }
      ]);
    }, 600);
  };

  // Window drag handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    dragStart.current = { x: e.clientX - simPos.x, y: e.clientY - simPos.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current) return;
    const newX = Math.max(20, Math.min(window.innerWidth - 500, e.clientX - dragStart.current.x));
    const newY = Math.max(20, Math.min(window.innerHeight - 600, e.clientY - dragStart.current.y));
    setSimPos({ x: newX, y: newY });
  };

  const handleMouseUp = () => {
    isDragging.current = false;
  };

  return (
    <div
      className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-purple-600/30 selection:text-purple-200"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* Top Navigation Bar */}
      <header className="border-b border-slate-800/80 bg-slate-900/70 backdrop-blur-md sticky top-0 z-50 px-6 py-3.5 flex items-center justify-between">
        <div className="flex items-center space-x-3.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-purple-600 via-indigo-600 to-cyan-400 p-[1px] shadow-lg shadow-purple-500/20">
            <div className="w-full h-full bg-slate-950 rounded-[11px] flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-purple-400" />
            </div>
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-bold text-base tracking-tight text-white">GeminiOverlay</span>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                PyQt6 • Windows x64
              </span>
            </div>
            <p className="text-xs text-slate-400">System-Wide Floating AI Assistant with Two-Way Gemini Live Audio</p>
          </div>
        </div>

        {/* Tab switchers */}
        <div className="flex items-center bg-slate-800/70 p-1 rounded-xl border border-slate-700/60">
          <button
            onClick={() => setActiveTab('simulator')}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'simulator'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/40'
            }`}
          >
            <Monitor className="w-3.5 h-3.5" />
            <span>Interactive Simulator</span>
          </button>
          <button
            onClick={() => setActiveTab('code')}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'code'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/40'
            }`}
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>Production Files (3)</span>
          </button>
          <button
            onClick={() => setActiveTab('docs')}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'docs'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/40'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Setup & DevOps Guide</span>
          </button>
        </div>

        {/* Global Hotkey Badge & Quick Actions */}
        <div className="flex items-center space-x-3 text-xs">
          <div className="hidden lg:flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-slate-800/60 border border-slate-700 text-slate-300">
            <span className="text-slate-500">Overlay:</span>
            <kbd className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-[10px] font-mono text-purple-300">Ctrl+Shift+Space</kbd>
          </div>
          <div className="hidden lg:flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-slate-800/60 border border-slate-700 text-slate-300">
            <span className="text-slate-500">Live Voice:</span>
            <kbd className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-[10px] font-mono text-cyan-300">Ctrl+Shift+V</kbd>
          </div>
        </div>
      </header>

      {/* Main Workspace Area */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* TAB 1: INTERACTIVE SIMULATOR */}
        {activeTab === 'simulator' && (
          <div className="flex-1 relative bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950/40 p-6 flex flex-col justify-between overflow-hidden">
            {/* Windows 11 Desktop Background Elements */}
            <div className="absolute inset-0 opacity-20 pointer-events-none bg-[radial-gradient(circle_at_50%_40%,rgba(147,51,234,0.35),transparent_60%)]" />
            <div className="absolute top-12 left-10 text-slate-700 select-none text-xs flex flex-col space-y-6">
              <div className="flex flex-col items-center space-y-1 hover:text-slate-400 cursor-pointer p-2 rounded-lg hover:bg-slate-800/30 w-16">
                <Monitor className="w-7 h-7 text-indigo-400" />
                <span className="text-[11px] text-center">This PC</span>
              </div>
              <div className="flex flex-col items-center space-y-1 hover:text-slate-400 cursor-pointer p-2 rounded-lg hover:bg-slate-800/30 w-16">
                <Github className="w-7 h-7 text-slate-400" />
                <span className="text-[11px] text-center">GeminiOverlay Repo</span>
              </div>
            </div>

            {/* Instruction banner */}
            <div className="relative z-10 max-w-2xl mx-auto bg-slate-900/90 border border-slate-800 rounded-xl px-4 py-2.5 shadow-xl flex items-center justify-between backdrop-blur-md">
              <div className="flex items-center space-x-2.5 text-xs text-slate-300">
                <Info className="w-4 h-4 text-purple-400 flex-shrink-0" />
                <span>
                  <strong>Interactive Windows UI Simulator:</strong> Drag the title bar, speak with the mic, capture screen, or test the system tray.
                </span>
              </div>
              <button
                onClick={() => setSimVisible(prev => !prev)}
                className="text-xs px-2.5 py-1 rounded bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 border border-purple-500/30 ml-4 font-medium transition-colors"
              >
                {simVisible ? 'Hide Window (Tray)' : 'Summon Overlay'}
              </button>
            </div>

            {/* FLOATING GLASSMORPHIC GEMINIOVERLAY WINDOW */}
            {simVisible && (
              <div
                style={{
                  position: 'absolute',
                  left: `${simPos.x}px`,
                  top: `${simPos.y}px`,
                  width: '450px',
                  height: '590px',
                  zIndex: 30
                }}
                className="rounded-[22px] p-[1px] bg-gradient-to-br from-white/20 via-purple-500/20 to-transparent shadow-2xl shadow-black/80 flex flex-col overflow-hidden backdrop-blur-2xl transition-shadow"
              >
                {/* Inner Card with purple-to-dark gradient */}
                <div className="w-full h-full rounded-[21px] bg-gradient-to-br from-[#1a1230]/95 via-[#0f0b1e]/98 to-[#160e28]/95 p-4 flex flex-col justify-between border border-white/10 select-none">
                  {/* Custom Draggable Title Bar */}
                  <div
                    onMouseDown={handleMouseDown}
                    className="flex items-center justify-between pb-3 border-b border-white/10 cursor-move"
                  >
                    <div className="flex items-center space-x-2.5">
                      <div className="w-6 h-6 rounded-lg bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center shadow-md shadow-purple-600/30">
                        <Sparkles className="w-3.5 h-3.5 text-white" />
                      </div>
                      <span className="font-semibold text-sm text-white font-['Segoe_UI'] tracking-tight">GeminiOverlay</span>
                    </div>

                    {/* Pill Segmented Tab Switcher */}
                    <div className="flex items-center bg-white/5 p-0.5 rounded-full border border-white/10">
                      <button
                        onClick={(e) => { e.stopPropagation(); setSimTab('assistant'); }}
                        className={`text-[11px] font-semibold px-3 py-1 rounded-full transition-all ${
                          simTab === 'assistant'
                            ? 'bg-purple-600 text-white shadow-sm'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Assistant
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setSimTab('settings'); }}
                        className={`text-[11px] font-semibold px-3 py-1 rounded-full transition-all ${
                          simTab === 'settings'
                            ? 'bg-purple-600 text-white shadow-sm'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Settings
                      </button>
                    </div>

                    {/* Action buttons (Pin, Minimize) */}
                    <div className="flex items-center space-x-1.5" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => setSimPinned(!simPinned)}
                        title="Pin Window"
                        className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors border ${
                          simPinned
                            ? 'bg-purple-600/40 border-purple-400 text-white'
                            : 'bg-white/5 border-white/10 text-slate-400 hover:text-white hover:bg-white/10'
                        }`}
                      >
                        <Pin className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setSimVisible(false)}
                        title="Minimize to Tray"
                        className="w-7 h-7 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* TAB 1: ASSISTANT TAB */}
                  {simTab === 'assistant' ? (
                    <div className="flex-1 flex flex-col justify-between py-3 overflow-hidden">
                      {/* Chat Browser Display */}
                      <div className="flex-1 overflow-y-auto space-y-3.5 pr-1.5 scrollbar-thin scrollbar-thumb-purple-900/40">
                        {simMessages.map((msg, i) => (
                          <div
                            key={i}
                            className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
                          >
                            {msg.sender === 'user' ? (
                              <div className="bg-purple-600/25 border border-purple-500/40 text-purple-100 text-xs px-3.5 py-2 rounded-2xl max-w-[85%] leading-relaxed shadow-sm">
                                <span className="font-semibold text-purple-300 block mb-0.5">You:</span>
                                {msg.text}
                              </div>
                            ) : (
                              <div className="bg-[#120e24]/80 border border-white/10 text-slate-200 text-xs px-3.5 py-2.5 rounded-2xl max-w-[92%] leading-relaxed shadow-sm">
                                <div className="flex items-center space-x-1.5 text-purple-400 font-semibold text-[11px] mb-1">
                                  <Sparkles className="w-3 h-3" />
                                  <span>Gemini:</span>
                                </div>
                                <div className="space-y-1.5 whitespace-pre-line font-['Segoe_UI']">
                                  {msg.text}
                                </div>
                              </div>
                            )}
                          </div>
                        ))}

                        {simStreaming && (
                          <div className="flex items-center space-x-2 text-xs text-purple-400 font-medium px-2 py-1">
                            <span className="w-2 h-2 rounded-full bg-purple-500 animate-ping" />
                            <span>Thinking & Streaming response...</span>
                          </div>
                        )}
                      </div>

                      {/* Live Voice Status Bar / Waveform (When active) */}
                      {simVoiceActive && (
                        <div className="my-2 p-2.5 rounded-xl bg-purple-950/60 border border-purple-500/40 flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <span className="relative flex h-2.5 w-2.5">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                            </span>
                            <span className="text-xs font-semibold text-purple-200">
                              Live Voice: {simVoiceState}
                            </span>
                          </div>

                          {/* Audio Wave Bars */}
                          <div className="flex items-center space-x-1">
                            {[16, 24, 12, 28, 20, 32, 14, 22].map((height, idx) => (
                              <div
                                key={idx}
                                style={{
                                  height: simVoiceState === 'Listening' || simVoiceState === 'Speaking' ? `${height}px` : '4px'
                                }}
                                className="w-1 bg-gradient-to-t from-purple-500 to-cyan-400 rounded-full transition-all duration-150 animate-pulse"
                              />
                            ))}
                          </div>

                          <button
                            onClick={() => setSimVoiceActive(false)}
                            className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-red-500/20 hover:bg-red-500/40 text-red-300 border border-red-500/30"
                          >
                            Stop
                          </button>
                        </div>
                      )}

                      {/* Prompt Input Box */}
                      <div className="mt-2 space-y-2">
                        <textarea
                          value={simInput}
                          onChange={e => setSimInput(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              handleSimSend();
                            }
                          }}
                          placeholder="Ask Gemini... (Enter to send, Shift+Enter for newline)"
                          rows={2}
                          className="w-full bg-[#120e22]/90 border border-white/12 focus:border-purple-500 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none transition-colors resize-none font-['Segoe_UI']"
                        />

                        {/* Control Buttons */}
                        <div className="flex items-center justify-between">
                          <button
                            onClick={handleSimScreenCapture}
                            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 text-xs font-medium transition-colors"
                          >
                            <Camera className="w-3.5 h-3.5 text-purple-300" />
                            <span>Capture & Analyze</span>
                          </button>

                          <div className="flex items-center space-x-2">
                            {/* Two-Way Voice Mic Button */}
                            <button
                              onClick={() => setSimVoiceActive(!simVoiceActive)}
                              title="Toggle Live Voice Conversation"
                              className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${
                                simVoiceActive
                                  ? 'bg-gradient-to-r from-red-500 to-rose-600 text-white shadow-lg shadow-red-500/50 scale-105 animate-pulse'
                                  : 'bg-white/8 hover:bg-purple-600/20 border border-white/15 text-purple-300 hover:text-white'
                              }`}
                            >
                              <Mic className="w-4 h-4" />
                            </button>

                            {/* Send Button */}
                            <button
                              onClick={handleSimSend}
                              className="flex items-center space-x-1.5 px-4 py-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-md shadow-purple-600/30 transition-all"
                            >
                              <span>Send</span>
                              <Send className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* TAB 2: SETTINGS TAB */
                    <div className="flex-1 flex flex-col justify-between py-3 overflow-y-auto pr-1 text-xs text-slate-300 space-y-3 font-['Segoe_UI']">
                      <div className="space-y-3">
                        {/* API Key */}
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                            Gemini API Key (DPAPI Encrypted at rest):
                          </label>
                          <div className="relative">
                            <input
                              type="password"
                              value={simApiKey}
                              onChange={e => setSimApiKey(e.target.value)}
                              className="w-full bg-[#120e22] border border-white/15 focus:border-purple-500 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none"
                            />
                            <div className="absolute right-2.5 top-2 text-[10px] text-purple-400 font-mono">
                              🔒 DPAPI
                            </div>
                          </div>
                        </div>

                        {/* Model Dropdown */}
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                            Text & Vision Model:
                          </label>
                          <select
                            value={simModel}
                            onChange={e => setSimModel(e.target.value)}
                            className="w-full bg-[#120e22] border border-white/15 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none"
                          >
                            <option value="gemini-2.5-flash">gemini-2.5-flash (Default)</option>
                            <option value="gemini-2.5-pro">gemini-2.5-pro</option>
                            <option value="gemini-2.5-flash-lite">gemini-2.5-flash-lite</option>
                          </select>
                        </div>

                        {/* Hotkeys */}
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[10px] font-semibold text-slate-400 mb-1">Toggle Hotkey:</label>
                            <input
                              type="text"
                              readOnly
                              value="Ctrl+Shift+Space"
                              className="w-full bg-[#120e22] border border-white/15 rounded-lg px-2 py-1 text-xs text-purple-300 font-mono"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-semibold text-slate-400 mb-1">Live Voice Hotkey:</label>
                            <input
                              type="text"
                              readOnly
                              value="Ctrl+Shift+V"
                              className="w-full bg-[#120e22] border border-white/15 rounded-lg px-2 py-1 text-xs text-cyan-300 font-mono"
                            />
                          </div>
                        </div>

                        {/* Voice Persona */}
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-300 mb-1">AI Voice Persona:</label>
                          <select
                            value={simSelectedVoice}
                            onChange={e => setSimSelectedVoice(e.target.value)}
                            className="w-full bg-[#120e22] border border-white/15 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none"
                          >
                            <option value="Puck">Puck (Natural, conversational)</option>
                            <option value="Charon">Charon (Deep, measured)</option>
                            <option value="Kore">Kore (Clear, soothing)</option>
                            <option value="Fenrir">Fenrir (Dynamic, energetic)</option>
                            <option value="Aoede">Aoede (Warm, melodic)</option>
                          </select>
                        </div>

                        {/* Checkboxes */}
                        <div className="space-y-2 pt-1 border-t border-white/10">
                          <label className="flex items-center space-x-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={simStartupEnabled}
                              onChange={e => setSimStartupEnabled(e.target.checked)}
                              className="rounded border-white/20 bg-purple-950 text-purple-600 focus:ring-0"
                            />
                            <span className="text-[11px]">Start with Windows (launch directly to tray)</span>
                          </label>

                          <label className="flex items-center space-x-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={simHeadphonesMode}
                              onChange={e => setSimHeadphonesMode(e.target.checked)}
                              className="rounded border-white/20 bg-purple-950 text-purple-600 focus:ring-0"
                            />
                            <span className="text-[11px]">I'm using headphones (allow barge-in interruptions)</span>
                          </label>

                          <label className="flex items-center space-x-2 cursor-pointer">
                            <input
                              type="checkbox"
                              defaultChecked={true}
                              className="rounded border-white/20 bg-purple-950 text-purple-600 focus:ring-0"
                            />
                            <span className="text-[11px]">Speak typed answers aloud (Gemini TTS)</span>
                          </label>
                        </div>
                      </div>

                      {/* Save feedback */}
                      <div className="flex items-center justify-between pt-2 border-t border-white/10">
                        {simSavedFeedback ? (
                          <span className="text-emerald-400 text-xs font-semibold">✓ Settings saved & reloaded!</span>
                        ) : (
                          <span />
                        )}
                        <button
                          onClick={() => {
                            setSimSavedFeedback(true);
                            setTimeout(() => setSimSavedFeedback(false), 2000);
                          }}
                          className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold text-xs shadow-md shadow-purple-600/30"
                        >
                          Save Settings
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Corner Resize Grip Mockup */}
                  <div className="flex justify-end pt-1">
                    <div className="w-2.5 h-2.5 border-r-2 border-b-2 border-slate-500/40 rounded-br cursor-se-resize" />
                  </div>
                </div>
              </div>
            )}

            {/* Windows 11 Taskbar Mockup with Live System Tray */}
            <div className="relative z-20 mt-auto bg-slate-900/95 border-t border-slate-800 px-4 py-1.5 flex items-center justify-between rounded-xl backdrop-blur-xl shadow-2xl">
              <div className="flex items-center space-x-3">
                <div className="w-6 h-6 rounded bg-blue-500 flex items-center justify-center text-white font-bold text-[10px]">
                  ⊞
                </div>
                <div className="w-5 h-5 rounded bg-slate-800 flex items-center justify-center text-slate-400 text-[10px]">
                  🔍
                </div>
              </div>

              {/* Center App Icons */}
              <div className="flex items-center space-x-2">
                <div className="px-2 py-1 rounded bg-slate-800/80 border border-slate-700/60 flex items-center space-x-2">
                  <div className="w-3.5 h-3.5 rounded-full bg-purple-500 animate-pulse" />
                  <span className="text-[11px] text-slate-300 font-mono">GeminiOverlay.exe [Active]</span>
                </div>
              </div>

              {/* Windows System Tray */}
              <div className="relative flex items-center space-x-3 text-xs text-slate-400">
                <span>ENG</span>

                {/* Gemini Tray Icon with Left/Right click support */}
                <div className="relative">
                  <button
                    onClick={() => setSimVisible(prev => !prev)}
                    onContextMenu={e => {
                      e.preventDefault();
                      setTrayMenuOpen(prev => !prev);
                    }}
                    title="GeminiOverlay Tray: Left-click toggles, Right-click opens menu"
                    className="p-1 rounded hover:bg-slate-800 text-purple-400 hover:text-purple-300 transition-colors flex items-center justify-center"
                  >
                    <div className="w-4 h-4 rounded-full bg-gradient-to-tr from-purple-500 to-indigo-500 flex items-center justify-center shadow-sm">
                      <Sparkles className="w-2.5 h-2.5 text-white" />
                    </div>
                  </button>

                  {/* Tray Context Menu */}
                  {trayMenuOpen && (
                    <div className="absolute bottom-8 right-0 w-44 bg-slate-900/98 border border-slate-700 rounded-lg shadow-2xl p-1 text-xs text-slate-200 z-50">
                      <button
                        onClick={() => { setSimVisible(true); setSimTab('assistant'); setTrayMenuOpen(false); }}
                        className="w-full text-left px-2.5 py-1.5 hover:bg-purple-600/30 rounded text-slate-200 hover:text-white"
                      >
                        Open Overlay
                      </button>
                      <button
                        onClick={() => { setSimVisible(true); setSimTab('settings'); setTrayMenuOpen(false); }}
                        className="w-full text-left px-2.5 py-1.5 hover:bg-purple-600/30 rounded text-slate-200 hover:text-white"
                      >
                        Settings
                      </button>
                      <div className="border-t border-slate-800 my-1" />
                      <button
                        onClick={() => { setSimStartupEnabled(p => !p); setTrayMenuOpen(false); }}
                        className="w-full text-left px-2.5 py-1.5 hover:bg-purple-600/30 rounded flex items-center justify-between"
                      >
                        <span>Start with Windows</span>
                        {simStartupEnabled && <span className="text-purple-400">✓</span>}
                      </button>
                      <div className="border-t border-slate-800 my-1" />
                      <button
                        onClick={() => { setSimVisible(false); setTrayMenuOpen(false); }}
                        className="w-full text-left px-2.5 py-1.5 hover:bg-red-500/20 text-red-400 rounded"
                      >
                        Exit GeminiOverlay
                      </button>
                    </div>
                  )}
                </div>

                <span>13:09</span>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: PRODUCTION DELIVERABLES CODE VIEWER */}
        {activeTab === 'code' && (
          <div className="flex-1 flex flex-col md:flex-row bg-slate-950 overflow-hidden">
            {/* Left sidebar: File selector */}
            <div className="w-full md:w-72 border-r border-slate-800 bg-slate-900/40 p-4 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider px-2 mb-2">
                  Deliverable Files (3)
                </div>

                <button
                  onClick={() => setSelectedFile('main.py')}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium transition-all ${
                    selectedFile === 'main.py'
                      ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
                      : 'text-slate-300 hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-center space-x-2.5">
                    <FileCode className="w-4 h-4 text-purple-400" />
                    <span>main.py</span>
                  </div>
                  <span className="text-[10px] opacity-75 font-mono">PyQt6 + GenAI</span>
                </button>

                <button
                  onClick={() => setSelectedFile('requirements.txt')}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium transition-all ${
                    selectedFile === 'requirements.txt'
                      ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
                      : 'text-slate-300 hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-center space-x-2.5">
                    <Layers className="w-4 h-4 text-cyan-400" />
                    <span>requirements.txt</span>
                  </div>
                  <span className="text-[10px] opacity-75 font-mono">Python 3.12</span>
                </button>

                <button
                  onClick={() => setSelectedFile('build-release.yml')}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium transition-all ${
                    selectedFile === 'build-release.yml'
                      ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
                      : 'text-slate-300 hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-center space-x-2.5">
                    <Github className="w-4 h-4 text-emerald-400" />
                    <span>build-release.yml</span>
                  </div>
                  <span className="text-[10px] opacity-75 font-mono">CI/CD</span>
                </button>
              </div>

              {/* Windows Integration Checklist */}
              <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2 mt-4">
                <div className="text-[11px] font-bold text-slate-300 flex items-center space-x-1.5">
                  <Shield className="w-3.5 h-3.5 text-purple-400" />
                  <span>Production Safeguards</span>
                </div>
                <div className="space-y-1.5 text-[11px] text-slate-400">
                  <div className="flex items-center space-x-1.5">
                    <Check className="w-3 h-3 text-emerald-400" />
                    <span>No hardcoded API keys</span>
                  </div>
                  <div className="flex items-center space-x-1.5">
                    <Check className="w-3 h-3 text-emerald-400" />
                    <span>Windows DPAPI at rest</span>
                  </div>
                  <div className="flex items-center space-x-1.5">
                    <Check className="w-3 h-3 text-emerald-400" />
                    <span>PortAudio 24kHz/16kHz stream</span>
                  </div>
                  <div className="flex items-center space-x-1.5">
                    <Check className="w-3 h-3 text-emerald-400" />
                    <span>QLockFile single-instance</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right main: Code Display */}
            <div className="flex-1 flex flex-col bg-slate-950 overflow-hidden">
              {/* Code viewer header */}
              <div className="px-6 py-3 border-b border-slate-800 bg-slate-900/30 flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <span className="text-xs font-mono font-bold text-white">
                    {selectedFile === 'build-release.yml' ? '.github/workflows/build-release.yml' : selectedFile}
                  </span>
                  <span className="text-[11px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                    Ready to copy or deploy
                  </span>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => {
                      const content =
                        selectedFile === 'main.py'
                          ? '// View main.py directly in workspace or copy below'
                          : selectedFile === 'requirements.txt'
                          ? REQUIREMENTS_TXT
                          : GITHUB_WORKFLOW_YML;
                      handleCopy(content, selectedFile);
                    }}
                    className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors"
                  >
                    {copiedKey === selectedFile ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy Code</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => {
                      const filename = selectedFile;
                      const content =
                        selectedFile === 'main.py'
                          ? 'Refer to main.py created in root directory'
                          : selectedFile === 'requirements.txt'
                          ? REQUIREMENTS_TXT
                          : GITHUB_WORKFLOW_YML;
                      handleDownloadFile(filename, content);
                    }}
                    className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 text-xs font-medium border border-purple-500/40 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download</span>
                  </button>
                </div>
              </div>

              {/* Code Pre Block */}
              <div className="flex-1 p-6 overflow-auto font-mono text-xs leading-relaxed text-slate-300">
                <pre className="selection:bg-purple-600/40">
                  {selectedFile === 'requirements.txt' && REQUIREMENTS_TXT}
                  {selectedFile === 'build-release.yml' && GITHUB_WORKFLOW_YML}
                  {selectedFile === 'main.py' &&
                    `# main.py is fully created and available at /main.py in your repository.
# Summary of components inside main.py:
# 1. create_gemini_icon: Programmatically drawn glowing high-DPI icon (QPainter).
# 2. ConfigManager: %APPDATA%\\GeminiOverlay\\config.json with Windows DPAPI encryption.
# 3. StartupManager: HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run support.
# 4. force_activate_window: Win32 AttachThreadInput focus enforcement.
# 5. GlobalHotkeyManager: pynput.keyboard.GlobalHotKeys with hotkey reload & Qt signals.
# 6. GeminiTextWorker: client.models.generate_content_stream text & vision worker.
# 7. TTSWorker: Gemini 2.5 TTS playback for typed answers with sounddevice.
# 8. LiveAudioSessionWorker: Dedicated QThread asyncio loop with client.aio.live.connect,
#    sounddevice 16kHz RawInputStream, 24kHz RawOutputStream, barge-in, transcription,
#    and screen injection.
# 9. GeminiOverlayWindow: Glassmorphism translucent frameless window with drag support,
#    tab switching, auto-hide pin toggle, and Segoe UI styling.
# 10. SystemTrayManager: QSystemTrayIcon with right-click menu and clean exit.
# 11. QLockFile: Single-instance enforcement.

# You can view the complete source directly in the project file tree (/main.py).`}
                </pre>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: SETUP & DEVOPS GUIDE */}
        {activeTab === 'docs' && (
          <div className="flex-1 p-8 overflow-y-auto max-w-4xl mx-auto space-y-8">
            <div>
              <h2 className="text-2xl font-bold text-white mb-2">Windows Local Setup & Release Guide</h2>
              <p className="text-sm text-slate-400">
                How to run GeminiOverlay locally, test hotkeys and voice, and publish standalone signed releases via GitHub Actions.
              </p>
            </div>

            {/* Quickstart 3-Step */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                <div className="w-7 h-7 rounded-lg bg-purple-600/30 text-purple-300 flex items-center justify-center font-bold text-xs">
                  1
                </div>
                <h4 className="font-semibold text-sm text-white">Create Virtual Environment</h4>
                <p className="text-xs text-slate-400">Python 3.10-3.12 64-bit on Windows 10/11.</p>
                <code className="block bg-slate-950 p-2 rounded text-[11px] font-mono text-purple-300">
                  python -m venv venv<br />
                  .\venv\Scripts\activate
                </code>
              </div>

              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                <div className="w-7 h-7 rounded-lg bg-cyan-600/30 text-cyan-300 flex items-center justify-center font-bold text-xs">
                  2
                </div>
                <h4 className="font-semibold text-sm text-white">Install Dependencies</h4>
                <p className="text-xs text-slate-400">Install PyQt6, google-genai, pywin32, etc.</p>
                <code className="block bg-slate-950 p-2 rounded text-[11px] font-mono text-cyan-300">
                  pip install -r requirements.txt
                </code>
              </div>

              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                <div className="w-7 h-7 rounded-lg bg-emerald-600/30 text-emerald-300 flex items-center justify-center font-bold text-xs">
                  3
                </div>
                <h4 className="font-semibold text-sm text-white">Launch Assistant</h4>
                <p className="text-xs text-slate-400">Starts in tray, opens overlay window.</p>
                <code className="block bg-slate-950 p-2 rounded text-[11px] font-mono text-emerald-300">
                  python main.py
                </code>
              </div>
            </div>

            {/* Build Standalone EXE Locally */}
            <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3">
              <h3 className="font-bold text-base text-white flex items-center space-x-2">
                <Terminal className="w-4 h-4 text-purple-400" />
                <span>Local PyInstaller Packaging Command</span>
              </h3>
              <p className="text-xs text-slate-400">
                Run this command in PowerShell to compile a single, zero-dependency <code>dist\GeminiOverlay.exe</code>:
              </p>
              <div className="relative">
                <pre className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 text-xs text-purple-300 font-mono overflow-x-auto">
{`pyinstaller \`
  --noconsole \`
  --onefile \`
  --name GeminiOverlay \`
  --clean \`
  --hidden-import pynput.keyboard._win32 \`
  --hidden-import pynput.mouse._win32 \`
  --collect-submodules google.genai \`
  --collect-submodules sounddevice \`
  --collect-data sounddevice \`
  --collect-binaries sounddevice \`
  main.py`}
                </pre>
              </div>
            </div>

            {/* Triggering GitHub Release */}
            <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3">
              <h3 className="font-bold text-base text-white flex items-center space-x-2">
                <Github className="w-4 h-4 text-emerald-400" />
                <span>Triggering an Automated Release (Tags)</span>
              </h3>
              <p className="text-xs text-slate-400">
                The GitHub Actions workflow (<code>.github/workflows/build-release.yml</code>) triggers automatically when pushing a semantic version tag:
              </p>
              <pre className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 text-xs text-emerald-300 font-mono">
{`git add .
git commit -m "feat: GeminiOverlay initial production release"
git tag v1.0.0
git push origin v1.0.0`}
              </pre>
              <p className="text-xs text-slate-400">
                GitHub Actions will build on <code>windows-latest</code>, bundle PortAudio and Google GenAI submodules, generate SHA256 checksums, and publish <code>GeminiOverlay.exe</code> to the GitHub Releases page.
              </p>
            </div>

            {/* Known Limitations */}
            <div className="p-5 rounded-2xl bg-amber-950/20 border border-amber-500/30 space-y-3">
              <h3 className="font-bold text-base text-amber-300 flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <span>Known Limitations & Windows Architectural Context</span>
              </h3>
              <ul className="space-y-2 text-xs text-slate-300 list-disc list-inside">
                <li>
                  <strong>Windows Foreground Stealing:</strong> Windows limits background processes from calling <code>SetForegroundWindow</code>. The code implements the Win32 <code>AttachThreadInput</code> trick to reliably bring the overlay to the foreground when global hotkeys are pressed.
                </li>
                <li>
                  <strong>DPAPI User Scope:</strong> API keys encrypted via Windows DPAPI (<code>win32crypt.CryptProtectData</code>) are tied to the current logged-in Windows user account. If the executable is run under a different user or service account, re-entering the key in Settings is required.
                </li>
                <li>
                  <strong>Exclusive Audio Devices:</strong> If another application holds exclusive WASAPI control over your microphone, <code>sounddevice</code> may throw an audio device busy error. Keep default shared mode in Windows Sound Settings.
                </li>
                <li>
                  <strong>High DPI Scaling:</strong> PyQt6 uses <code>PassThrough</code> high DPI rounding. On multi-monitor setups with mixed scaling (e.g. 150% laptop + 100% 4K monitor), dragging the window across screens is handled automatically.
                </li>
              </ul>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
