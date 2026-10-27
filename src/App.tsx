import React, { useState, useEffect, useRef } from 'react';
import {
  Terminal,
  FileCode,
  Github,
  Play,
  Copy,
  Check,
  Download,
  Mic,
  Camera,
  Scissors,
  Send,
  Pin,
  Minus,
  Sparkles,
  Volume2,
  Monitor,
  Settings,
  Info,
  Brain,
  Trash2,
  Plus,
  Headphones,
  Sliders,
  X,
  Zap,
  Gamepad2,
  Cpu,
  Layers,
  ArrowRight,
  ArrowLeft,
  MousePointer,
  Globe,
  ShieldCheck
} from 'lucide-react';
import MAIN_PY from '../main.py?raw';

const REQUIREMENTS_TXT = `# Mark-LVI / GeminiOverlay - Python Dependencies
# Compatible with Python 3.10, 3.11, and 3.12 on Windows 10/11 (64-bit)

# Official Google GenAI SDK (supports Gemini 3.5-flash-lite / 3.8 and Gemini Live API)
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

# Discord Rich Presence Overlay (mewo010 & light_134)
pypresence>=4.3.0

# OS Automation & Mouse Control (Mark-LVI Action Handlers)
pyautogui>=0.9.54
`;

const GITHUB_WORKFLOW_YML = `name: Build & Release GeminiOverlay (Mark-LVI)

on:
  push:
    branches:
      - main
      - master
    tags:
      - 'v*'
      - 'v*.*.*'
  pull_request:
    branches:
      - main
  workflow_dispatch:
    inputs:
      tag_name:
        description: 'Release tag name (leave blank to auto-version by run number, e.g. v1.0.1)'
        type: string
        required: false
        default: ''

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
            --hidden-import pypresence \`
            --hidden-import pyautogui \`
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
    if: needs.build.result == 'success' && github.event_name != 'pull_request'

    steps:
      - name: Download Build Artifact
        uses: actions/download-artifact@v4
        with:
          name: GeminiOverlay-windows-x64
          path: dist

      - name: Determine Release Tag
        id: tag_info
        shell: bash
        run: |
          if [ "\${{ github.ref_type }}" = "tag" ]; then
            TAG="\${{ github.ref_name }}"
          elif [ -n "\${{ inputs.tag_name }}" ]; then
            TAG="\${{ inputs.tag_name }}"
          else
            TAG="v1.0.\${{ github.run_number }}"
          fi
          echo "release_tag=\$TAG" >> \$GITHUB_OUTPUT
          echo "Using release tag: \$TAG"

      - name: Publish Release with Assets
        uses: softprops/action-gh-release@v2
        with:
          tag_name: \${{ steps.tag_info.outputs.release_tag }}
          name: GeminiOverlay \${{ steps.tag_info.outputs.release_tag }}
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
  const [activeTab, setActiveTab] = useState<'simulator' | 'code' | 'architecture'>('simulator');
  const [selectedFile, setSelectedFile] = useState<'main.py' | 'requirements.txt' | 'build-release.yml'>('main.py');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Mark-LVI Modular Assistant States
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState<1 | 2>(1);

  // Overlay Dock State
  const [dockVisible, setDockVisible] = useState(true);
  const [dockPinned, setDockPinned] = useState(false);
  const [isAnswering, setIsAnswering] = useState(false);

  // Region Snipping Tool Interactive State
  const [isSnippingMode, setIsSnippingMode] = useState(false);
  const [snipStart, setSnipStart] = useState<{ x: number; y: number } | null>(null);
  const [snipCurrent, setSnipCurrent] = useState<{ x: number; y: number } | null>(null);
  const [translationResult, setTranslationResult] = useState<string | null>(null);

  // Voice Engine State
  const [continuousListening, setContinuousListening] = useState(false);
  const [selfEchoGuarded, setSelfEchoGuarded] = useState(true);

  // Provider & Model State
  const [activeProvider, setActiveProvider] = useState<'gemini' | 'groq' | 'deepseek' | 'ollama' | 'openai'>('gemini');
  const [activeModel, setActiveModel] = useState('gemini-3.5-flash-lite');
  const [targetLang, setTargetLang] = useState('English');

  // Discord RPC State
  const [discordState, setDiscordState] = useState<'Idle' | 'Listening' | 'Thinking' | 'Snipping & Translating'>('Idle');
  const [discordElapsed, setDiscordElapsed] = useState(42);

  // Chat conversation
  const [messages, setMessages] = useState<Array<{ sender: 'user' | 'gemini' | 'system'; text: string; isVision?: boolean }>>([
    {
      sender: 'gemini',
      text: "Mark-LVI initialized. Created by mewo010 and light_134.\nPress **Ctrl+Shift+Space** to summon the dock, **Ctrl+Shift+T** (or click ✂️) to snip any screen region for auto-translation, or ask me to control apps."
    }
  ]);
  const [inputText, setInputText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  // Discord timer ticker
  useEffect(() => {
    const timer = setInterval(() => {
      setDiscordElapsed(prev => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatElapsed = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

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

  // Trigger Snipping Mode
  const triggerSnipping = () => {
    setDockVisible(false);
    setIsSnippingMode(true);
    setDiscordState('Snipping & Translating');
    setSnipStart(null);
    setSnipCurrent(null);
  };

  const handleSnipMouseDown = (e: React.MouseEvent) => {
    setSnipStart({ x: e.clientX, y: e.clientY });
    setSnipCurrent({ x: e.clientX, y: e.clientY });
  };

  const handleSnipMouseMove = (e: React.MouseEvent) => {
    if (snipStart) {
      setSnipCurrent({ x: e.clientX, y: e.clientY });
    }
  };

  const handleSnipMouseUp = () => {
    if (snipStart && snipCurrent) {
      const width = Math.abs(snipCurrent.x - snipStart.x);
      const height = Math.abs(snipCurrent.y - snipStart.y);

      if (width > 20 && height > 20) {
        setIsSnippingMode(false);
        setDockVisible(true);
        setIsAnswering(true);
        setDiscordState('Thinking');

        // Simulate instant OCR & translation
        setTimeout(() => {
          setDiscordState('Idle');
          setIsAnswering(false);
          const sampleResult = `[OCR Detection - Hebrew / German / Code]\n"ברוכים הבאים לעוזר האישי החדש שלכם"\n\n→ Translated to ${targetLang}:\n"Welcome to your next-generation personal assistant. Ready for desktop automation and voice control."`;
          setTranslationResult(sampleResult);
          setMessages(prev => [
            ...prev,
            { sender: 'user', text: `[Screen Snipped ✂️ ${width}×${height}px]` },
            { sender: 'gemini', text: sampleResult }
          ]);
        }, 600);
      } else {
        setIsSnippingMode(false);
        setDockVisible(true);
      }
    }
    setSnipStart(null);
    setSnipCurrent(null);
  };

  // Send Chat message
  const handleSendMessage = () => {
    if (!inputText.trim() || isStreaming) return;
    const prompt = inputText.trim();
    setInputText('');
    setIsAnswering(true);
    setDiscordState('Thinking');

    setMessages(prev => [...prev, { sender: 'user', text: prompt }]);
    setIsStreaming(true);

    const isHello = ['hello', 'hi', 'hey'].includes(prompt.toLowerCase().replace(/[^\w]/g, ''));
    const isMouse = prompt.toLowerCase().includes('mouse') || prompt.toLowerCase().includes('click');

    setTimeout(() => {
      setIsStreaming(false);
      setIsAnswering(false);
      setDiscordState('Idle');

      let reply = '';
      if (isHello) {
        reply = `Hello King! Mark-LVI is active. Ultra-Fast ${activeModel} responded in 180ms. Discord RPC is broadcasting: 'Created by mewo010 and light_134'.`;
      } else if (isMouse) {
        reply = `[Desktop Automation Handler] Executing smooth cursor action via pyautogui: moved to active target with safety boundaries enforced.`;
      } else {
        reply = `Executed request via ${activeProvider.toUpperCase()} (${activeModel}). Continuous listening is ${continuousListening ? 'ON' : 'OFF'} with Self-Echo Guard active.`;
      }

      setMessages(prev => [...prev, { sender: 'gemini', text: reply }]);
    }, isHello ? 220 : 500);
  };

  return (
    <div className="min-h-screen bg-[#080b13] text-slate-100 flex flex-col font-sans selection:bg-sky-500/30 selection:text-sky-200">
      {/* Top Header */}
      <header className="border-b border-slate-800/80 bg-[#0d111a]/90 backdrop-blur-md sticky top-0 z-50 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-3.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-sky-500 via-indigo-600 to-cyan-400 p-[1px] shadow-lg shadow-sky-500/20">
            <div className="w-full h-full bg-[#0d111a] rounded-[11px] flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-sky-400" />
            </div>
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-bold text-base tracking-tight text-white">Mark-LVI • GeminiOverlay</span>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/30">
                Created by mewo010 & light_134
              </span>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center space-x-1">
                <Zap className="w-2.5 h-2.5" />
                <span>Modular Provider Engine</span>
              </span>
            </div>
            <p className="text-xs text-slate-400">Onboarding Wizard • Win+Shift+S Snipping Tool & Translation • Desktop Mouse Automation</p>
          </div>
        </div>

        {/* Tab switchers */}
        <div className="flex items-center bg-slate-800/70 p-1 rounded-xl border border-slate-700/60">
          <button
            onClick={() => setActiveTab('simulator')}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'simulator'
                ? 'bg-sky-600 text-white shadow-md shadow-sky-600/30'
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
                ? 'bg-sky-600 text-white shadow-md shadow-sky-600/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/40'
            }`}
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>Production Code (3 Files)</span>
          </button>
          <button
            onClick={() => setActiveTab('architecture')}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'architecture'
                ? 'bg-sky-600 text-white shadow-md shadow-sky-600/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/40'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Mark-LVI Blueprint</span>
          </button>
        </div>

        {/* Status / Quick Launcher */}
        <div className="flex items-center space-x-2 text-xs">
          <button
            onClick={() => {
              setOnboardingOpen(true);
              setOnboardingStep(1);
            }}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 font-medium transition-colors"
          >
            <Sliders className="w-3.5 h-3.5 text-sky-400" />
            <span>Onboarding Wizard</span>
          </button>
          <div className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-[#5865F2]/20 border border-[#5865F2]/30 text-[#c7d0ff]">
            <Gamepad2 className="w-3.5 h-3.5 text-[#5865F2]" />
            <span className="font-semibold text-[11px]">{discordState}</span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {/* SIMULATOR TAB */}
        {activeTab === 'simulator' && (
          <div className="flex-1 relative bg-gradient-to-br from-[#070a12] via-[#0d121f] to-[#11182c] p-6 flex flex-col justify-between overflow-hidden select-none">
            {/* Desktop Mockup Background */}
            <div className="absolute inset-0 opacity-25 pointer-events-none p-8 flex space-x-6">
              <div className="flex-1 rounded-xl border border-slate-700 bg-slate-900/60 p-4 font-mono text-xs text-slate-400 space-y-2">
                <div className="flex items-center space-x-2 pb-2 border-b border-slate-800 text-slate-500">
                  <div className="w-3 h-3 rounded-full bg-red-500" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500" />
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                  <span className="ml-2">Mark-LVI Modular Core — Visual Studio Code</span>
                </div>
                <p className="text-sky-400"># Inspired by FatihMakes/Mark-LVI</p>
                <p className="text-purple-400">class ScreenSnippingOverlay(QWidget):</p>
                <p className="pl-4 text-slate-300">"""Win+Shift+S style interactive region snipper with OCR translation."""</p>
                <p className="text-emerald-400">class UniversalProviderEngine:</p>
                <p className="pl-4 text-slate-300">"""Multi-model fallback ladder supporting Gemini, Groq, DeepSeek, Ollama."""</p>
              </div>

              {/* Discord Profile Status Box */}
              <div className="w-72 h-56 rounded-xl border border-[#5865F2]/40 bg-[#1e1f22]/90 p-3.5 text-xs text-white space-y-2">
                <div className="flex items-center space-x-2 border-b border-white/10 pb-1.5">
                  <Gamepad2 className="w-4 h-4 text-[#5865F2]" />
                  <span className="font-bold text-slate-200">Discord Live Status</span>
                </div>
                <div className="space-y-1">
                  <p className="font-bold text-white text-[13px]">GeminiOverlay</p>
                  <p className="text-[11px] text-slate-300">Interacting with AI ({discordState})</p>
                  <p className="text-[11px] text-sky-400 font-semibold">Created by mewo010 and light_134</p>
                  <p className="text-[10px] text-slate-400 font-mono">{formatElapsed(discordElapsed)} elapsed</p>
                </div>
              </div>
            </div>

            {/* Quick Action Top Bar */}
            <div className="relative z-10 max-w-4xl mx-auto bg-[#101622]/90 border border-slate-800 rounded-xl px-4 py-2.5 shadow-xl flex items-center justify-between backdrop-blur-md">
              <div className="flex items-center space-x-3 text-xs text-slate-300">
                <Scissors className="w-4 h-4 text-sky-400 flex-shrink-0" />
                <span>
                  <strong>Try Region Snipping:</strong> Click <strong>✂️ Snip & Translate</strong> (or press <kbd className="bg-slate-800 px-1 py-0.5 rounded text-sky-300">Ctrl+Shift+T</kbd>) to drag a box over any screen area for auto-translation.
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={triggerSnipping}
                  className="text-xs px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold flex items-center space-x-1.5 shadow-md shadow-sky-600/30 transition-all"
                >
                  <Scissors className="w-3.5 h-3.5" />
                  <span>✂️ Snip Screen (Win+Shift+S)</span>
                </button>
                <button
                  onClick={() => setDockVisible(p => !p)}
                  className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-medium transition-colors"
                >
                  {dockVisible ? 'Hide Dock' : 'Summon Dock'}
                </button>
              </div>
            </div>

            {/* FLOATING BOTTOM-MIDDLE DOCK (640x420 COMFORTABLE SIZE) */}
            {dockVisible && !isSnippingMode && (
              <div
                style={{
                  position: 'absolute',
                  left: '50%',
                  bottom: '60px',
                  transform: 'translateX(-50%)',
                  width: '640px',
                  height: '420px',
                  zIndex: 40
                }}
                className={`flex flex-col rounded-2xl transition-all duration-200 shadow-2xl shadow-black/90 ${
                  isAnswering
                    ? 'border border-white/15 bg-[#0d1117]/75 backdrop-blur-md'
                    : 'border border-white/12 bg-[#121620]/95 backdrop-blur-xl'
                }`}
              >
                <div className="p-3.5 flex flex-col h-full justify-between space-y-2">
                  {/* Top Bar inside Dock */}
                  <div className="flex items-center justify-between pb-1.5 border-b border-white/10 select-none">
                    <div className="flex items-center space-x-2">
                      <div className="w-5 h-5 rounded-lg bg-sky-500 flex items-center justify-center shadow-sm">
                        <Sparkles className="w-3 h-3 text-white" />
                      </div>
                      <span className="font-semibold text-xs text-white">GeminiOverlay</span>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/25">
                        by mewo010 & light_134
                      </span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/25">
                        {activeProvider.toUpperCase()}: {activeModel}
                      </span>
                    </div>

                    <div className="flex items-center space-x-1.5">
                      <button
                        onClick={() => setDockPinned(!dockPinned)}
                        title="Pin Dock"
                        className={`w-6 h-6 rounded-md flex items-center justify-center transition-colors text-xs ${
                          dockPinned ? 'bg-sky-500/30 text-sky-300 border border-sky-400' : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        <Pin className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => {
                          setOnboardingOpen(true);
                          setOnboardingStep(1);
                        }}
                        title="Open Onboarding & Configuration Wizard"
                        className="w-6 h-6 rounded-md flex items-center justify-center text-slate-400 hover:text-white transition-colors"
                      >
                        <Settings className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setDockVisible(false)}
                        title="Minimize to Tray"
                        className="w-6 h-6 rounded-md flex items-center justify-center text-slate-400 hover:text-white transition-colors"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Conversation Browser */}
                  <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 scrollbar-thin scrollbar-thumb-slate-700">
                    {messages.map((msg, i) => (
                      <div key={i} className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}>
                        {msg.sender === 'user' && (
                          <div className="bg-sky-600/30 border border-sky-500/40 text-sky-100 text-xs px-3 py-1.5 rounded-xl max-w-[85%] leading-relaxed">
                            <span className="font-semibold text-sky-300 block text-[10px]">You</span>
                            {msg.text}
                          </div>
                        )}
                        {msg.sender === 'gemini' && (
                          <div className="bg-[#121722]/85 border border-white/10 text-slate-200 text-xs px-3.5 py-2 rounded-xl max-w-[92%] leading-relaxed shadow-sm">
                            <div className="flex items-center space-x-1.5 text-sky-400 font-semibold text-[11px] mb-1">
                              <Sparkles className="w-3 h-3" />
                              <span>Assistant (Mark-LVI):</span>
                            </div>
                            <div className="space-y-1 whitespace-pre-line font-['Segoe_UI']">{msg.text}</div>
                          </div>
                        )}
                      </div>
                    ))}

                    {isStreaming && (
                      <div className="flex items-center space-x-2 text-xs text-sky-400 px-2 py-1">
                        <span className="w-2 h-2 rounded-full bg-sky-400 animate-ping" />
                        <span>Processing with {activeModel}...</span>
                      </div>
                    )}
                  </div>

                  {/* Input & Action Buttons */}
                  <div className="pt-1.5 border-t border-white/10 flex items-center space-x-2">
                    {/* Snipping Button */}
                    <button
                      onClick={triggerSnipping}
                      title="Interactive Region Snipping & Translation (Ctrl+Shift+T)"
                      className="w-9 h-9 rounded-full bg-sky-600/20 hover:bg-sky-600/40 border border-sky-500/40 flex items-center justify-center text-sky-300 hover:text-white transition-colors flex-shrink-0"
                    >
                      <Scissors className="w-4 h-4" />
                    </button>

                    <button
                      onClick={() => {
                        setDockVisible(false);
                        setTimeout(() => {
                          setDockVisible(true);
                          setMessages(m => [
                            ...m,
                            { sender: 'user', text: '[Full Screen Captured 📷]' },
                            { sender: 'gemini', text: 'Screen captured and analyzed. Active windows identified: VS Code and Discord.' }
                          ]);
                        }, 400);
                      }}
                      title="Analyze Full Screen"
                      className="w-9 h-9 rounded-full bg-slate-800 hover:bg-slate-700 border border-white/10 flex items-center justify-center text-slate-300 hover:text-white transition-colors flex-shrink-0"
                    >
                      <Camera className="w-4 h-4" />
                    </button>

                    <input
                      type="text"
                      value={inputText}
                      onChange={e => setInputText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleSendMessage();
                      }}
                      placeholder="Type a request, or ask to move mouse, click, translate..."
                      className="flex-1 bg-[#090d16] border border-white/12 focus:border-sky-500 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none transition-colors"
                    />

                    <button
                      onClick={() => setContinuousListening(!continuousListening)}
                      title="Continuous Open-Mic Mode with Self-Echo Guard"
                      className={`w-9 h-9 rounded-full flex items-center justify-center transition-all flex-shrink-0 ${
                        continuousListening
                          ? 'bg-red-500 text-white animate-pulse shadow-md shadow-red-500/50'
                          : 'bg-slate-800 hover:bg-slate-700 border border-white/10 text-sky-400 hover:text-white'
                      }`}
                    >
                      <Mic className="w-4 h-4" />
                    </button>

                    <button
                      onClick={handleSendMessage}
                      disabled={isStreaming}
                      className="w-9 h-9 rounded-full bg-sky-600 hover:bg-sky-500 text-white flex items-center justify-center shadow-md shadow-sky-600/30 transition-all flex-shrink-0 disabled:opacity-50"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* FULLSCREEN REGION SNIPPING SIMULATOR OVERLAY (WIN+SHIFT+S STYLE) */}
            {isSnippingMode && (
              <div
                className="fixed inset-0 z-50 bg-black/40 cursor-crosshair select-none"
                onMouseDown={handleSnipMouseDown}
                onMouseMove={handleSnipMouseMove}
                onMouseUp={handleSnipMouseUp}
              >
                <div className="absolute top-8 left-1/2 transform -translate-x-1/2 bg-slate-900/90 border border-sky-500/40 text-sky-200 text-xs px-4 py-2 rounded-xl shadow-2xl flex items-center space-x-2 backdrop-blur-md">
                  <Scissors className="w-4 h-4 text-sky-400" />
                  <span>Click and drag a box to snip & auto-translate into {targetLang}. Press Esc or Right-Click to cancel.</span>
                </div>

                {snipStart && snipCurrent && (
                  <div
                    style={{
                      position: 'absolute',
                      left: `${Math.min(snipStart.x, snipCurrent.x)}px`,
                      top: `${Math.min(snipStart.y, snipCurrent.y)}px`,
                      width: `${Math.abs(snipCurrent.x - snipStart.x)}px`,
                      height: `${Math.abs(snipCurrent.y - snipStart.y)}px`
                    }}
                    className="border-2 border-sky-400 bg-sky-400/10 shadow-2xl"
                  >
                    <div className="absolute -top-7 left-0 bg-slate-900 border border-sky-500/50 text-[10px] text-sky-300 font-bold px-2 py-0.5 rounded shadow">
                      {Math.abs(snipCurrent.x - snipStart.x)} × {Math.abs(snipCurrent.y - snipStart.y)} px • Auto-Translate
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* FLOATING TRANSLATION RESULT HUD */}
            {translationResult && (
              <div className="absolute top-24 left-1/2 transform -translate-x-1/2 z-40 w-96 rounded-2xl bg-[#0d1117]/95 border border-sky-500/40 p-4 shadow-2xl backdrop-blur-xl animate-in fade-in">
                <div className="flex items-center justify-between pb-2 border-b border-white/10">
                  <div className="flex items-center space-x-1.5 text-sky-400 font-bold text-xs">
                    <Globe className="w-4 h-4" />
                    <span>Region Snippet Translation</span>
                  </div>
                  <button
                    onClick={() => setTranslationResult(null)}
                    className="text-slate-400 hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="mt-2.5 font-mono text-xs text-slate-200 whitespace-pre-line leading-relaxed bg-[#080c14] p-3 rounded-xl border border-white/5">
                  {translationResult}
                </div>
                <div className="mt-3 flex justify-end space-x-2">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(translationResult);
                      setTranslationResult(null);
                    }}
                    className="px-3 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs flex items-center space-x-1"
                  >
                    <Copy className="w-3 h-3" />
                    <span>Copy Text</span>
                  </button>
                </div>
              </div>
            )}

            {/* Taskbar with System Tray */}
            <div className="relative z-20 mt-auto bg-[#0d1117]/95 border-t border-slate-800 px-4 py-1.5 flex items-center justify-between rounded-xl backdrop-blur-xl shadow-2xl">
              <div className="flex items-center space-x-3">
                <div className="w-6 h-6 rounded bg-sky-500 flex items-center justify-center text-white font-bold text-[10px]">⊞</div>
                <div className="w-5 h-5 rounded bg-slate-800 flex items-center justify-center text-slate-400 text-[10px]">🔍</div>
              </div>

              <div className="flex items-center space-x-2">
                <div className="px-2.5 py-1 rounded-lg bg-slate-800/80 border border-slate-700 flex items-center space-x-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-[11px] text-slate-200 font-mono">Mark-LVI Active • Discord RPC Connected</span>
                </div>
              </div>

              <div className="flex items-center space-x-3 text-xs text-slate-400">
                <span>ENG</span>
                <div className="w-4 h-4 rounded-full bg-sky-500 flex items-center justify-center text-white font-bold text-[9px]">
                  ✦
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 2-STEP ONBOARDING WIZARD MODAL */}
        {onboardingOpen && (
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
            <div className="w-full max-w-lg bg-[#0d1117] border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col font-['Segoe_UI']">
              {/* Wizard Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-[#161b22]">
                <div className="flex items-center space-x-2.5">
                  <div className="w-7 h-7 rounded-lg bg-sky-500 flex items-center justify-center">
                    <Sparkles className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <span className="font-bold text-sm text-white">GeminiOverlay Setup Wizard</span>
                    <span className="text-[10px] text-sky-400 block font-semibold">Created by mewo010 and light_134</span>
                  </div>
                </div>
                <button
                  onClick={() => setOnboardingOpen(false)}
                  className="text-slate-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Wizard Body */}
              <div className="p-6 space-y-4 text-xs">
                {onboardingStep === 1 ? (
                  /* STEP 1: PROVIDER & KEYS */
                  <div className="space-y-4">
                    <div className="flex items-center space-x-2 text-sky-300 font-bold text-xs pb-1 border-b border-white/10">
                      <Cpu className="w-4 h-4 text-sky-400" />
                      <span>Step 1: Choose AI Engine & Enter Credentials</span>
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-300 mb-1">Primary LLM Provider (Never locked into one API):</label>
                      <select
                        value={activeProvider}
                        onChange={e => {
                          const p = e.target.value as any;
                          setActiveProvider(p);
                          if (p === 'gemini') setActiveModel('gemini-3.5-flash-lite');
                          if (p === 'groq') setActiveModel('llama-3.3-70b-versatile');
                          if (p === 'deepseek') setActiveModel('deepseek-chat');
                          if (p === 'ollama') setActiveModel('llama3.2');
                        }}
                        className="w-full bg-[#161b22] border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
                      >
                        <option value="gemini">Google Gemini (Default - Free Keys via Google AI Studio)</option>
                        <option value="groq">Groq (Ultra-Fast Cloud Llama 3 / DeepSeek)</option>
                        <option value="deepseek">DeepSeek API (DeepSeek-V3 / R1)</option>
                        <option value="ollama">Ollama (Local Offline Model)</option>
                        <option value="openai">OpenAI API</option>
                      </select>
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-300 mb-1">API Key (Windows DPAPI Encrypted at rest):</label>
                      <input
                        type="password"
                        placeholder="Paste your API key here (AIzaSy... / gsk_... / sk-...)"
                        defaultValue="AIzaSyD...•[DPAPI Encrypted]"
                        className="w-full bg-[#161b22] border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500 font-mono"
                      />
                    </div>

                    <div className="p-3 rounded-xl bg-sky-950/30 border border-sky-500/20 text-sky-300 text-[11px] leading-relaxed">
                      💡 <strong>Free Access:</strong> Get a free Gemini API key in 10 seconds at <b>aistudio.google.com</b> with no billing setup required.
                    </div>
                  </div>
                ) : (
                  /* STEP 2: KEYBINDS MAPPING */
                  <div className="space-y-4">
                    <div className="flex items-center space-x-2 text-sky-300 font-bold text-xs pb-1 border-b border-white/10">
                      <Sliders className="w-4 h-4 text-sky-400" />
                      <span>Step 2: Keybind Mapping & Shortcuts</span>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <label className="block font-semibold text-slate-300 mb-1">Toggle Assistant Overlay:</label>
                        <input
                          type="text"
                          readOnly
                          value="Ctrl+Shift+Space"
                          className="w-full bg-[#161b22] border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-sky-400 font-mono"
                        />
                      </div>

                      <div>
                        <label className="block font-semibold text-slate-300 mb-1">Interactive Region Snipping (Win+Shift+S style):</label>
                        <input
                          type="text"
                          readOnly
                          value="Ctrl+Shift+T"
                          className="w-full bg-[#161b22] border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-emerald-400 font-mono"
                        />
                      </div>

                      <div>
                        <label className="block font-semibold text-slate-300 mb-1">Push-to-Talk / Continuous Voice Toggle:</label>
                        <input
                          type="text"
                          readOnly
                          value="Ctrl+Shift+V"
                          className="w-full bg-[#161b22] border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-cyan-400 font-mono"
                        />
                      </div>

                      <div>
                        <label className="block font-semibold text-slate-300 mb-1">Target Translation Language:</label>
                        <select
                          value={targetLang}
                          onChange={e => setTargetLang(e.target.value)}
                          className="w-full bg-[#161b22] border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none"
                        >
                          <option>English</option>
                          <option>Hebrew</option>
                          <option>Spanish</option>
                          <option>French</option>
                          <option>German</option>
                        </select>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Wizard Footer */}
              <div className="px-6 py-3.5 border-t border-slate-800 bg-[#161b22] flex items-center justify-between">
                {onboardingStep === 2 ? (
                  <button
                    onClick={() => setOnboardingStep(1)}
                    className="px-3.5 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white text-xs font-semibold flex items-center space-x-1"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Back</span>
                  </button>
                ) : (
                  <span className="text-[11px] text-slate-500">Step 1 of 2</span>
                )}

                {onboardingStep === 1 ? (
                  <button
                    onClick={() => setOnboardingStep(2)}
                    className="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs flex items-center space-x-1.5"
                  >
                    <span>Next: Keybinds</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  <button
                    onClick={() => setOnboardingOpen(false)}
                    className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center space-x-1.5"
                  >
                    <span>Finish & Launch</span>
                    <Check className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* PRODUCTION CODE VIEWER TAB */}
        {activeTab === 'code' && (
          <div className="flex-1 flex flex-col md:flex-row bg-[#0b0f19] overflow-hidden">
            <div className="w-full md:w-64 border-r border-slate-800/80 bg-[#0d111a] p-4 flex flex-col justify-between">
              <div className="space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-2 block">
                  Production Deliverables
                </span>
                <button
                  onClick={() => setSelectedFile('main.py')}
                  className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                    selectedFile === 'main.py' ? 'bg-sky-600 text-white shadow-md shadow-sky-600/20' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  <FileCode className="w-4 h-4 text-sky-400" />
                  <span>main.py (Modular)</span>
                </button>
                <button
                  onClick={() => setSelectedFile('requirements.txt')}
                  className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                    selectedFile === 'requirements.txt' ? 'bg-sky-600 text-white shadow-md shadow-sky-600/20' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  <FileCode className="w-4 h-4 text-emerald-400" />
                  <span>requirements.txt</span>
                </button>
                <button
                  onClick={() => setSelectedFile('build-release.yml')}
                  className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                    selectedFile === 'build-release.yml' ? 'bg-sky-600 text-white shadow-md shadow-sky-600/20' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  <Github className="w-4 h-4 text-cyan-400" />
                  <span>build-release.yml</span>
                </button>
              </div>

              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-[11px] text-slate-400 space-y-1">
                <div className="text-sky-300 font-semibold">Mark-LVI Architecture:</div>
                <div>• Onboarding Wizard dialog</div>
                <div>• Screen Snipping & Translation</div>
                <div>• Universal Provider Fallback</div>
                <div>• Safe Desktop Automation</div>
                <div>• Discord IPC Rich Presence</div>
              </div>
            </div>

            <div className="flex-1 flex flex-col bg-[#080c14] overflow-hidden">
              <div className="px-6 py-3 border-b border-slate-800/80 bg-[#0d111a] flex items-center justify-between">
                <div className="flex items-center space-x-2 text-xs font-mono text-slate-300">
                  <span className="text-slate-500">File:</span>
                  <span className="text-sky-400 font-bold">{selectedFile}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => {
                      const content = selectedFile === 'requirements.txt' ? REQUIREMENTS_TXT : selectedFile === 'build-release.yml' ? GITHUB_WORKFLOW_YML : MAIN_PY;
                      handleCopy(content, selectedFile);
                    }}
                    className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
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
                      const content = selectedFile === 'requirements.txt' ? REQUIREMENTS_TXT : selectedFile === 'build-release.yml' ? GITHUB_WORKFLOW_YML : MAIN_PY;
                      handleDownloadFile(selectedFile, content);
                    }}
                    className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download</span>
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-auto p-6 font-mono text-xs text-slate-300 leading-relaxed scrollbar-thin scrollbar-thumb-slate-800">
                <pre>
                  {selectedFile === 'requirements.txt' && REQUIREMENTS_TXT}
                  {selectedFile === 'build-release.yml' && GITHUB_WORKFLOW_YML}
                  {selectedFile === 'main.py' && MAIN_PY}
                </pre>
              </div>
            </div>
          </div>
        )}

        {/* ARCHITECTURE BLUEPRINT TAB */}
        {activeTab === 'architecture' && (
          <div className="flex-1 bg-[#0b0f19] p-8 overflow-y-auto">
            <div className="max-w-4xl mx-auto space-y-6">
              <div className="p-6 rounded-2xl bg-gradient-to-r from-sky-950/40 via-indigo-950/30 to-slate-900 border border-sky-500/20">
                <h1 className="text-xl font-bold text-white mb-2">Mark-LVI Blueprint & Modular System</h1>
                <p className="text-sm text-slate-300 leading-relaxed">
                  Inspired by <strong>FatihMakes/Mark-LVI</strong>, this system decouples UI presentation, audio streams, vision OCR translation, desktop automation, and universal LLM providers into independent modules with safety boundaries.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
                  <div className="flex items-center space-x-2 text-sky-400 font-bold text-sm">
                    <Scissors className="w-4 h-4" />
                    <span>1. Win+Shift+S Screen Snipping</span>
                  </div>
                  <p className="text-slate-400 leading-relaxed">
                    Custom <code>ScreenSnippingOverlay</code> dims the screen and allows click-and-drag box selection. The cropped buffer is passed directly to the vision OCR model and translated into your target language.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
                  <div className="flex items-center space-x-2 text-emerald-400 font-bold text-sm">
                    <Zap className="w-4 h-4" />
                    <span>2. Universal Provider Engine</span>
                  </div>
                  <p className="text-slate-400 leading-relaxed">
                    Users can freely switch between Google Gemini, Groq, DeepSeek, Ollama, LM Studio, or OpenAI. A 9-rung fallback ladder ensures uninterrupted operation even during provider outages.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
                  <div className="flex items-center space-x-2 text-[#5865F2] font-bold text-sm">
                    <Gamepad2 className="w-4 h-4" />
                    <span>3. Robust Discord Rich Presence</span>
                  </div>
                  <p className="text-slate-400 leading-relaxed">
                    Uses Windows local IPC named pipes (<code>\\.\pipe\discord-ipc-0</code>) to broadcast: "Interacting with AI Assistant", "Created by mewo010 and light_134", with live state indicators.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
                  <div className="flex items-center space-x-2 text-purple-400 font-bold text-sm">
                    <MousePointer className="w-4 h-4" />
                    <span>4. Safe OS Automation</span>
                  </div>
                  <p className="text-slate-400 leading-relaxed">
                    <code>DesktopAutomationHandler</code> wraps <code>pyautogui</code> and <code>pynput</code> to allow smooth mouse movement, clicking, typing, and app launching within verified coordinate bounds.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
