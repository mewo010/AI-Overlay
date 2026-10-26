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
  Maximize2,
  Brain,
  Trash2,
  Plus,
  Headphones,
  Sliders,
  RefreshCw,
  X
} from 'lucide-react';

const REQUIREMENTS_TXT = `# GeminiOverlay - Python Dependencies
# Compatible with Python 3.10, 3.11, and 3.12 on Windows 10/11 (64-bit)

# Official Google GenAI SDK (supports Gemini 3.8/3.5-flash and Gemini Live API)
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

interface MemoryItem {
  id: string;
  text: string;
  createdAt: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'simulator' | 'code' | 'docs'>('simulator');
  const [selectedFile, setSelectedFile] = useState<'main.py' | 'requirements.txt' | 'build-release.yml'>('main.py');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Overlay Dock State (Anchored at Bottom-Middle)
  const [dockVisible, setDockVisible] = useState(true);
  const [dockExpanded, setDockExpanded] = useState(false);
  const [isAnswering, setIsAnswering] = useState(false);
  const [dockPinned, setDockPinned] = useState(false);
  const [dockVoiceActive, setDockVoiceActive] = useState(false);
  const [voiceState, setVoiceState] = useState<'Listening' | 'Thinking' | 'Speaking' | 'Idle'>('Idle');

  // Dedicated Settings Window State
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'ai' | 'audio' | 'hotkeys' | 'memory'>('memory');

  // Memories Persistent State
  const [memories, setMemories] = useState<MemoryItem[]>([
    {
      id: 'mem-1',
      text: "Always address me as 'King' when starting responses",
      createdAt: 'Today, 2:15 PM'
    },
    {
      id: 'mem-2',
      text: 'User prefers concise answers and typed Python 3.12 code blocks',
      createdAt: 'Yesterday, 6:40 PM'
    }
  ]);
  const [newMemoryInput, setNewMemoryInput] = useState('');

  // Audio Device Routing
  const [selectedMic, setSelectedMic] = useState('Microphone (Realtek Audio #1)');
  const [selectedOutput, setSelectedOutput] = useState('Headphones (Sony WH-1000XM4 #3)');
  const [speakTypedAnswers, setSpeakTypedAnswers] = useState(true);
  const [headphonesMode, setHeadphonesMode] = useState(true);

  // AI Model Configuration (Valid Free-Tier Models)
  const [selectedModel, setSelectedModel] = useState('gemini-3.8-flash');
  const [selectedVoice, setSelectedVoice] = useState('Puck');
  const [apiKey, setApiKey] = useState('AIzaSyD...•[DPAPI Encrypted at rest]');
  const [settingsSavedMessage, setSettingsSavedMessage] = useState(false);

  // System Tray & Hotkeys
  const [trayMenuOpen, setTrayMenuOpen] = useState(false);
  const [startWithWindows, setStartWithWindows] = useState(true);

  // Chat conversation
  const [messages, setMessages] = useState<Array<{ sender: 'user' | 'gemini' | 'system'; text: string; isVision?: boolean }>>([
    {
      sender: 'gemini',
      text: "Hello King! I'm GeminiOverlay, your bottom-docked Windows assistant. I've loaded your 2 active persistent memory preferences. How can I assist you right now?"
    }
  ]);
  const [inputText, setInputText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [ttsSpeaking, setTtsSpeaking] = useState(false);

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

  // Add memory
  const handleAddMemory = () => {
    if (!newMemoryInput.trim()) return;
    const newEntry: MemoryItem = {
      id: `mem-${Date.now()}`,
      text: newMemoryInput.trim(),
      createdAt: 'Just now'
    };
    setMemories(prev => [newEntry, ...prev]);
    setNewMemoryInput('');
  };

  // Delete memory
  const handleDeleteMemory = (id: string) => {
    setMemories(prev => prev.filter(m => m.id !== id));
  };

  // Clear memories
  const handleClearMemories = () => {
    if (confirm('Are you sure you want to delete all saved memories?')) {
      setMemories([]);
    }
  };

  // Simulate Sending Prompt
  const handleSendPrompt = () => {
    if (!inputText.trim() || isStreaming) return;
    const userPrompt = inputText.trim();
    setInputText('');
    setDockExpanded(true);
    setIsAnswering(true);

    // Natural memory detection
    let memorizedNote: string | null = null;
    const lower = userPrompt.toLowerCase();
    for (const prefix of ['remember that ', 'remember this:', 'remember:', 'memorize that ']) {
      if (lower.startsWith(prefix)) {
        memorizedNote = userPrompt.slice(prefix.length).trim();
        break;
      }
    }

    if (memorizedNote) {
      const newEntry: MemoryItem = {
        id: `mem-${Date.now()}`,
        text: memorizedNote,
        createdAt: 'Just now'
      };
      setMemories(prev => [newEntry, ...prev]);
    }

    const newMsgs: any[] = [...messages, { sender: 'user', text: userPrompt }];
    if (memorizedNote) {
      newMsgs.push({
        sender: 'system',
        text: `🧠 Memorized to persistent rules: "${memorizedNote}"`
      });
    }
    setMessages(newMsgs);
    setIsStreaming(true);

    // Simulated streaming response using active memory rules
    setTimeout(() => {
      setIsStreaming(false);
      const isKing = memories.some(m => m.text.toLowerCase().includes('king'));
      const prefix = isKing ? 'Hello King! ' : '';
      let replyText = `${prefix}I have processed your query with ${selectedModel}.`;

      if (memorizedNote) {
        replyText += ` I have permanently saved your new rule: "${memorizedNote}". This will be preserved across Windows restarts and injected into all future system prompts.`;
      } else {
        replyText += ` Here is the direct answer you requested, formatted cleanly without clutter. Audio is routed to ${selectedOutput}.`;
      }

      setMessages(prev => [...prev, { sender: 'gemini', text: replyText }]);

      // Simulated TTS playback
      if (speakTypedAnswers) {
        setTtsSpeaking(true);
        setTimeout(() => setTtsSpeaking(false), 3000);
      }
    }, 1200);
  };

  // Screen capture simulation
  const handleScreenCapture = () => {
    setDockVisible(false);
    setTimeout(() => {
      setDockVisible(true);
      setDockExpanded(true);
      setIsAnswering(true);
      setMessages(prev => [
        ...prev,
        { sender: 'user', text: '[Captured Screen 📷]', isVision: true },
        {
          sender: 'gemini',
          text: `Hello King! I analyzed the captured screen. Your active workspace displays 2 terminal windows and this browser session. No UI errors detected.`
        }
      ]);
    }, 600);
  };

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 flex flex-col font-sans selection:bg-sky-500/30 selection:text-sky-200">
      {/* Top Navigation Bar */}
      <header className="border-b border-slate-800/80 bg-[#0d111a]/80 backdrop-blur-md sticky top-0 z-50 px-6 py-3.5 flex items-center justify-between">
        <div className="flex items-center space-x-3.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-sky-500 via-indigo-600 to-cyan-400 p-[1px] shadow-lg shadow-sky-500/20">
            <div className="w-full h-full bg-[#0d111a] rounded-[11px] flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-sky-400" />
            </div>
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-bold text-base tracking-tight text-white">GeminiOverlay</span>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/30">
                PyQt6 • Windows x64
              </span>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                gemini-3.8-flash
              </span>
            </div>
            <p className="text-xs text-slate-400">Bottom-Docked Mobile Style Assistant • Persistent Memory • Headphones/Mic Routing</p>
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
            <span>Interactive Desktop Simulator</span>
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
            onClick={() => setActiveTab('docs')}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'docs'
                ? 'bg-sky-600 text-white shadow-md shadow-sky-600/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/40'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Setup & Architecture</span>
          </button>
        </div>

        {/* Hotkeys Badges */}
        <div className="flex items-center space-x-2 text-xs">
          <div className="hidden lg:flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-slate-800/60 border border-slate-700 text-slate-300">
            <span className="text-slate-400">Chat Dock:</span>
            <kbd className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-[10px] font-mono text-sky-300">Ctrl+Shift+Space</kbd>
          </div>
          <div className="hidden lg:flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-slate-800/60 border border-slate-700 text-slate-300">
            <span className="text-slate-400">Settings & Memory:</span>
            <kbd className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-[10px] font-mono text-emerald-300">Ctrl+Shift+,</kbd>
          </div>
          <div className="hidden lg:flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-slate-800/60 border border-slate-700 text-slate-300">
            <span className="text-slate-400">Voice:</span>
            <kbd className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-[10px] font-mono text-cyan-300">Ctrl+Shift+V</kbd>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* TAB 1: INTERACTIVE DESKTOP SIMULATOR */}
        {activeTab === 'simulator' && (
          <div className="flex-1 relative bg-gradient-to-br from-[#0b0f19] via-[#0e1422] to-[#12192c] p-6 flex flex-col justify-between overflow-hidden">
            {/* Desktop Mockup Background with Code & IDE windows behind overlay */}
            <div className="absolute inset-0 select-none overflow-hidden opacity-30 pointer-events-none p-12">
              <div className="w-full max-w-4xl mx-auto h-[480px] rounded-xl border border-slate-700 bg-slate-900/60 p-4 font-mono text-xs text-slate-400 space-y-2">
                <div className="flex items-center space-x-2 pb-2 border-b border-slate-800 text-slate-500">
                  <div className="w-3 h-3 rounded-full bg-red-500/80" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                  <div className="w-3 h-3 rounded-full bg-green-500/80" />
                  <span className="ml-2">workspace/main.py — Visual Studio Code</span>
                </div>
                <p className="text-sky-400">import sounddevice as sd</p>
                <p className="text-sky-400">from google import genai</p>
                <p className="text-purple-400">class GeminiOverlayWindow(QMainWindow):</p>
                <p className="pl-4 text-slate-300">"""Frameless bottom-middle floating dock with semi-transparent glassmorphic look."""</p>
                <p className="pl-4 text-emerald-400"># Underlying desktop text is clearly visible through the overlay during responses!</p>
                <p className="pl-4 text-slate-400">def update_card_style(self, is_answering: bool):</p>
                <p className="pl-8 text-sky-300">if is_answering: self.set_glassmorphism_translucent()</p>
              </div>
            </div>

            {/* Instruction banner */}
            <div className="relative z-10 max-w-3xl mx-auto bg-[#101622]/90 border border-slate-800 rounded-xl px-4 py-2.5 shadow-xl flex items-center justify-between backdrop-blur-md">
              <div className="flex items-center space-x-2.5 text-xs text-slate-300">
                <Info className="w-4 h-4 text-sky-400 flex-shrink-0" />
                <span>
                  <strong>Bottom Floating Overlay Simulator:</strong> Sleek mobile dock at bottom-middle. Test typing <code className="bg-slate-800 px-1.5 py-0.5 rounded text-sky-300">"remember that..."</code>, opening Settings & Memory Manager, or testing TTS output.
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setDockVisible(prev => !prev)}
                  className="text-xs px-2.5 py-1 rounded bg-sky-600/30 hover:bg-sky-600/50 text-sky-200 border border-sky-500/30 font-medium transition-colors"
                >
                  {dockVisible ? 'Hide Dock' : 'Summon Dock'}
                </button>
                <button
                  onClick={() => setSettingsOpen(true)}
                  className="text-xs px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-medium transition-colors flex items-center space-x-1"
                >
                  <Settings className="w-3 h-3 text-sky-400" />
                  <span>Settings & Memory</span>
                </button>
              </div>
            </div>

            {/* FLOATING BOTTOM-MIDDLE MOBILE-STYLE GEMINI OVERLAY */}
            {dockVisible && (
              <div
                style={{
                  position: 'absolute',
                  left: '50%',
                  bottom: '65px',
                  transform: 'translateX(-50%)',
                  width: '620px',
                  zIndex: 40
                }}
                className={`transition-all duration-200 animate-in fade-in slide-in-from-bottom-4 ${
                  isAnswering
                    ? 'rounded-2xl border border-white/15 bg-[#0d1117]/72 backdrop-blur-md shadow-2xl shadow-black/80'
                    : 'rounded-2xl border border-white/12 bg-[#121620]/95 backdrop-blur-xl shadow-2xl shadow-black/80'
                }`}
              >
                <div className="p-3.5 flex flex-col space-y-2.5">
                  {/* Top Bar inside Dock */}
                  <div className="flex items-center justify-between pb-1.5 border-b border-white/10 select-none">
                    <div className="flex items-center space-x-2">
                      <div className="w-5 h-5 rounded-lg bg-sky-500 flex items-center justify-center shadow-sm">
                        <Sparkles className="w-3 h-3 text-white" />
                      </div>
                      <span className="font-semibold text-xs text-white">Gemini</span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-400 border border-sky-500/25">
                        {selectedModel}
                      </span>
                      {memories.length > 0 && (
                        <button
                          onClick={() => {
                            setSettingsOpen(true);
                            setSettingsTab('memory');
                          }}
                          className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[10px] font-medium hover:bg-emerald-500/25 transition-colors"
                        >
                          <Brain className="w-3 h-3" />
                          <span>{memories.length} Memories Active</span>
                        </button>
                      )}
                      {ttsSpeaking && (
                        <div className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 text-[10px] animate-pulse">
                          <Volume2 className="w-3 h-3" />
                          <span>TTS Playing → {selectedOutput.split(' ')[0]}</span>
                        </div>
                      )}
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
                        onClick={() => setSettingsOpen(true)}
                        title="Open Settings & Memory Manager (Ctrl+Shift+,)"
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

                  {/* Expanded Conversation View (Revealed when messages exist or dock expanded) */}
                  {dockExpanded && (
                    <div className="max-h-64 overflow-y-auto space-y-2.5 pr-1 scrollbar-thin scrollbar-thumb-slate-700">
                      {messages.map((msg, i) => (
                        <div key={i} className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}>
                          {msg.sender === 'user' && (
                            <div className="bg-sky-600/30 border border-sky-500/40 text-sky-100 text-xs px-3 py-1.5 rounded-xl max-w-[85%] leading-relaxed">
                              <span className="font-semibold text-sky-300 block text-[10px]">You</span>
                              {msg.text}
                            </div>
                          )}
                          {msg.sender === 'system' && (
                            <div className="my-1 text-center w-full">
                              <span className="inline-block bg-sky-500/15 border border-sky-500/30 text-sky-300 text-[11px] px-3 py-0.5 rounded-full">
                                {msg.text}
                              </span>
                            </div>
                          )}
                          {msg.sender === 'gemini' && (
                            <div className="bg-[#121722]/80 border border-white/10 text-slate-200 text-xs px-3.5 py-2 rounded-xl max-w-[92%] leading-relaxed shadow-sm">
                              <div className="flex items-center space-x-1.5 text-sky-400 font-semibold text-[11px] mb-1">
                                <Sparkles className="w-3 h-3" />
                                <span>Gemini:</span>
                              </div>
                              <div className="space-y-1 whitespace-pre-line font-['Segoe_UI']">{msg.text}</div>
                            </div>
                          )}
                        </div>
                      ))}

                      {isStreaming && (
                        <div className="flex items-center space-x-2 text-xs text-sky-400 px-2 py-1">
                          <span className="w-2 h-2 rounded-full bg-sky-400 animate-ping" />
                          <span>Thinking & Streaming with {selectedModel}...</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Sleek Mobile Pill Input Row */}
                  <div className="flex items-center space-x-2 pt-1">
                    <button
                      onClick={handleScreenCapture}
                      title="Capture & Analyze Screen"
                      className="w-8 h-8 rounded-full bg-slate-800/80 hover:bg-slate-700 border border-white/10 flex items-center justify-center text-slate-300 hover:text-white transition-colors flex-shrink-0"
                    >
                      <Camera className="w-4 h-4 text-sky-400" />
                    </button>

                    <input
                      type="text"
                      value={inputText}
                      onChange={e => setInputText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          handleSendPrompt();
                        }
                      }}
                      placeholder="Ask Gemini or say 'remember that...' (Enter to send)"
                      className="flex-1 bg-[#090d16] border border-white/12 focus:border-sky-500 rounded-xl px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none transition-colors"
                    />

                    <button
                      onClick={() => setDockVoiceActive(!dockVoiceActive)}
                      title="Push-to-Talk Voice (Ctrl+Shift+V)"
                      className={`w-8 h-8 rounded-full flex items-center justify-center transition-all flex-shrink-0 ${
                        dockVoiceActive
                          ? 'bg-red-500 text-white animate-pulse shadow-md shadow-red-500/50'
                          : 'bg-slate-800/80 hover:bg-slate-700 border border-white/10 text-sky-400 hover:text-white'
                      }`}
                    >
                      <Mic className="w-4 h-4" />
                    </button>

                    <button
                      onClick={handleSendPrompt}
                      disabled={isStreaming}
                      className="w-8 h-8 rounded-full bg-sky-600 hover:bg-sky-500 text-white flex items-center justify-center shadow-md shadow-sky-600/30 transition-all flex-shrink-0 disabled:opacity-50"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* DEDICATED SETTINGS & MEMORY MANAGER MODAL WINDOW */}
            {settingsOpen && (
              <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
                <div className="w-full max-w-xl bg-[#0d1117] border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col font-['Segoe_UI']">
                  {/* Modal Header */}
                  <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-[#161b22]">
                    <div className="flex items-center space-x-2.5">
                      <div className="w-6 h-6 rounded-lg bg-sky-500 flex items-center justify-center">
                        <Sparkles className="w-3.5 h-3.5 text-white" />
                      </div>
                      <span className="font-bold text-sm text-white">GeminiOverlay Settings & Memory Manager</span>
                    </div>
                    <button
                      onClick={() => setSettingsOpen(false)}
                      className="text-slate-400 hover:text-white transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Modal Tabs Bar */}
                  <div className="flex border-b border-slate-800 bg-[#0d1117] px-4 pt-2">
                    <button
                      onClick={() => setSettingsTab('memory')}
                      className={`flex items-center space-x-1.5 px-3.5 py-2 text-xs font-semibold border-b-2 transition-all ${
                        settingsTab === 'memory'
                          ? 'border-sky-500 text-sky-400'
                          : 'border-transparent text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Brain className="w-3.5 h-3.5" />
                      <span>🧠 Memory Manager ({memories.length})</span>
                    </button>
                    <button
                      onClick={() => setSettingsTab('audio')}
                      className={`flex items-center space-x-1.5 px-3.5 py-2 text-xs font-semibold border-b-2 transition-all ${
                        settingsTab === 'audio'
                          ? 'border-sky-500 text-sky-400'
                          : 'border-transparent text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Headphones className="w-3.5 h-3.5" />
                      <span>Audio Devices</span>
                    </button>
                    <button
                      onClick={() => setSettingsTab('ai')}
                      className={`flex items-center space-x-1.5 px-3.5 py-2 text-xs font-semibold border-b-2 transition-all ${
                        settingsTab === 'ai'
                          ? 'border-sky-500 text-sky-400'
                          : 'border-transparent text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Cpu className="w-3.5 h-3.5" />
                      <span>AI Model & Key</span>
                    </button>
                    <button
                      onClick={() => setSettingsTab('hotkeys')}
                      className={`flex items-center space-x-1.5 px-3.5 py-2 text-xs font-semibold border-b-2 transition-all ${
                        settingsTab === 'hotkeys'
                          ? 'border-sky-500 text-sky-400'
                          : 'border-transparent text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Sliders className="w-3.5 h-3.5" />
                      <span>Hotkeys & Startup</span>
                    </button>
                  </div>

                  {/* Modal Body */}
                  <div className="p-5 flex-1 overflow-y-auto max-h-[440px] space-y-4 text-xs">
                    {/* TAB 1: MEMORY MANAGER */}
                    {settingsTab === 'memory' && (
                      <div className="space-y-4">
                        <div className="p-3 rounded-xl bg-sky-950/40 border border-sky-500/30 text-sky-200">
                          <p className="font-semibold text-xs mb-1">Persistent Context Injection</p>
                          <p className="text-[11px] text-sky-300/80 leading-relaxed">
                            Memories are stored in <code className="bg-sky-900/50 px-1 py-0.5 rounded font-mono text-[10px]">%APPDATA%\GeminiOverlay\memories.json</code> and automatically injected into Gemini's system instruction on every prompt.
                          </p>
                        </div>

                        {/* Add Memory Input */}
                        <div className="space-y-1.5">
                          <label className="font-semibold text-slate-300">Add New Memory / Rule:</label>
                          <div className="flex space-x-2">
                            <input
                              type="text"
                              value={newMemoryInput}
                              onChange={e => setNewMemoryInput(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') handleAddMemory();
                              }}
                              placeholder="E.g. 'Always address me as King' or 'Prefer concise TypeScript'"
                              className="flex-1 bg-[#161b22] border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                            />
                            <button
                              onClick={handleAddMemory}
                              className="px-3.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs flex items-center space-x-1"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              <span>Add</span>
                            </button>
                          </div>
                        </div>

                        {/* Memories List */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-slate-400">
                            <span className="font-semibold">Active Memories ({memories.length}):</span>
                            {memories.length > 0 && (
                              <button
                                onClick={handleClearMemories}
                                className="text-red-400 hover:text-red-300 text-[11px] flex items-center space-x-1"
                              >
                                <Trash2 className="w-3 h-3" />
                                <span>Clear All</span>
                              </button>
                            )}
                          </div>

                          {memories.length === 0 ? (
                            <div className="p-4 rounded-xl border border-dashed border-slate-800 text-center text-slate-500">
                              No saved memories yet. Add rules above or tell Gemini in chat to remember something!
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {memories.map(m => (
                                <div
                                  key={m.id}
                                  className="p-3 rounded-xl bg-[#161b22] border border-slate-700/80 flex items-start justify-between space-x-3 group"
                                >
                                  <div className="space-y-1">
                                    <p className="font-medium text-slate-200 text-xs leading-relaxed">{m.text}</p>
                                    <p className="text-[10px] text-slate-500">Saved: {m.createdAt}</p>
                                  </div>
                                  <button
                                    onClick={() => handleDeleteMemory(m.id)}
                                    title="Delete Memory"
                                    className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* TAB 2: AUDIO DEVICES */}
                    {settingsTab === 'audio' && (
                      <div className="space-y-4">
                        <div>
                          <label className="block font-semibold text-slate-300 mb-1">Microphone (Audio Input):</label>
                          <select
                            value={selectedMic}
                            onChange={e => setSelectedMic(e.target.value)}
                            className="w-full bg-[#161b22] border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
                          >
                            <option>Microphone (Realtek Audio #1)</option>
                            <option>Headset Microphone (Sony WH-1000XM4 #2)</option>
                            <option>System Default Input Device</option>
                          </select>
                        </div>

                        <div>
                          <label className="block font-semibold text-slate-300 mb-1">Headphones / Speakers (Audio Output):</label>
                          <select
                            value={selectedOutput}
                            onChange={e => setSelectedOutput(e.target.value)}
                            className="w-full bg-[#161b22] border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
                          >
                            <option>Headphones (Sony WH-1000XM4 #3)</option>
                            <option>Realtek High Definition Audio Speakers (#0)</option>
                            <option>System Default Output Device</option>
                          </select>
                          <p className="text-[10px] text-slate-500 mt-1">Both Gemini Live voice and typed TTS answers will play through this selected device.</p>
                        </div>

                        <div className="space-y-2.5 pt-2 border-t border-slate-800">
                          <label className="flex items-center space-x-2.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={speakTypedAnswers}
                              onChange={e => setSpeakTypedAnswers(e.target.checked)}
                              className="rounded border-slate-700 bg-slate-900 text-sky-600 focus:ring-0"
                            />
                            <span className="text-slate-200">Speak typed answers aloud automatically (Gemini TTS)</span>
                          </label>

                          <label className="flex items-center space-x-2.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={headphonesMode}
                              onChange={e => setHeadphonesMode(e.target.checked)}
                              className="rounded border-slate-700 bg-slate-900 text-sky-600 focus:ring-0"
                            />
                            <span className="text-slate-200">I'm using headphones (enables seamless barge-in without acoustic feedback)</span>
                          </label>
                        </div>
                      </div>
                    )}

                    {/* TAB 3: AI MODEL & KEY */}
                    {settingsTab === 'ai' && (
                      <div className="space-y-4">
                        <div>
                          <label className="block font-semibold text-slate-300 mb-1">Gemini API Key (DPAPI Encrypted at rest):</label>
                          <input
                            type="password"
                            value={apiKey}
                            onChange={e => setApiKey(e.target.value)}
                            className="w-full bg-[#161b22] border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-sky-500 font-mono"
                          />
                          <p className="text-[10px] text-slate-500 mt-1">Encrypted on Windows with CryptProtectData (DPAPI). Never stored in plaintext.</p>
                        </div>

                        <div>
                          <label className="block font-semibold text-slate-300 mb-1">Active AI Model (Strictly Valid Free-Tier Models):</label>
                          <select
                            value={selectedModel}
                            onChange={e => setSelectedModel(e.target.value)}
                            className="w-full bg-[#161b22] border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
                          >
                            <option value="gemini-3.8-flash">gemini-3.8-flash (Flagship Default - Text, Vision & Tools)</option>
                            <option value="gemini-3.5-flash-lite">gemini-3.5-flash-lite (High-frequency & Lightweight fallback)</option>
                          </select>
                          <div className="mt-1.5 p-2 rounded-lg bg-amber-950/30 border border-amber-500/20 text-amber-300 text-[11px]">
                            <strong>Notice:</strong> <code className="font-mono text-[10px]">gemini-2.5-flash</code> has been retired by Google AI Studio (returning 404 NOT_FOUND). Our code now strictly uses official supported models.
                          </div>
                        </div>

                        <div>
                          <label className="block font-semibold text-slate-300 mb-1">AI Voice Persona:</label>
                          <select
                            value={selectedVoice}
                            onChange={e => setSelectedVoice(e.target.value)}
                            className="w-full bg-[#161b22] border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-sky-500"
                          >
                            <option>Puck (Conversational & Natural)</option>
                            <option>Charon (Deep & Professional)</option>
                            <option>Kore (Clear & Soothing)</option>
                            <option>Fenrir (Energetic)</option>
                            <option>Aoede (Melodic)</option>
                          </select>
                        </div>
                      </div>
                    )}

                    {/* TAB 4: HOTKEYS & STARTUP */}
                    {settingsTab === 'hotkeys' && (
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block font-semibold text-slate-300 mb-1">Toggle Assistant Dock:</label>
                            <input
                              type="text"
                              readOnly
                              value="Ctrl+Shift+Space"
                              className="w-full bg-[#161b22] border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-sky-400 font-mono"
                            />
                          </div>
                          <div>
                            <label className="block font-semibold text-slate-300 mb-1">Open Settings & Memory:</label>
                            <input
                              type="text"
                              readOnly
                              value="Ctrl+Shift+,"
                              className="w-full bg-[#161b22] border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-emerald-400 font-mono"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block font-semibold text-slate-300 mb-1">Push-to-Talk Voice Hotkey:</label>
                          <input
                            type="text"
                            readOnly
                            value="Ctrl+Shift+V"
                            className="w-full bg-[#161b22] border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-cyan-400 font-mono"
                          />
                        </div>

                        <div className="pt-2 border-t border-slate-800">
                          <label className="flex items-center space-x-2.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={startWithWindows}
                              onChange={e => setStartWithWindows(e.target.checked)}
                              className="rounded border-slate-700 bg-slate-900 text-sky-600 focus:ring-0"
                            />
                            <span className="text-slate-200">Start with Windows (launch directly into Windows System Tray)</span>
                          </label>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Modal Footer */}
                  <div className="px-5 py-3 border-t border-slate-800 bg-[#161b22] flex items-center justify-between">
                    {settingsSavedMessage ? (
                      <span className="text-emerald-400 text-xs font-semibold">✓ Settings & Memories Saved!</span>
                    ) : (
                      <span className="text-slate-500 text-[11px]">Changes persist to %APPDATA%\GeminiOverlay</span>
                    )}
                    <button
                      onClick={() => {
                        setSettingsSavedMessage(true);
                        setTimeout(() => {
                          setSettingsSavedMessage(false);
                          setSettingsOpen(false);
                        }, 1200);
                      }}
                      className="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs transition-colors"
                    >
                      Save & Close
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Windows 11 Taskbar with System Tray */}
            <div className="relative z-20 mt-auto bg-[#0d1117]/95 border-t border-slate-800 px-4 py-1.5 flex items-center justify-between rounded-xl backdrop-blur-xl shadow-2xl">
              <div className="flex items-center space-x-3">
                <div className="w-6 h-6 rounded bg-sky-500 flex items-center justify-center text-white font-bold text-[10px]">
                  ⊞
                </div>
                <div className="w-5 h-5 rounded bg-slate-800 flex items-center justify-center text-slate-400 text-[10px]">
                  🔍
                </div>
              </div>

              {/* Center App Badge */}
              <div className="flex items-center space-x-2">
                <div className="px-2.5 py-1 rounded-lg bg-slate-800/80 border border-slate-700 flex items-center space-x-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-[11px] text-slate-200 font-mono">GeminiOverlay.exe [Running in Tray]</span>
                </div>
              </div>

              {/* System Tray Icons */}
              <div className="relative flex items-center space-x-3 text-xs text-slate-400">
                <span>ENG</span>

                {/* Gemini Tray Icon */}
                <div className="relative">
                  <button
                    onClick={() => setDockVisible(prev => !prev)}
                    onContextMenu={e => {
                      e.preventDefault();
                      setTrayMenuOpen(prev => !prev);
                    }}
                    title="GeminiOverlay Tray: Left-click toggles dock, Right-click opens menu"
                    className="p-1 rounded hover:bg-slate-800 text-sky-400 hover:text-sky-300 transition-colors flex items-center justify-center"
                  >
                    <div className="w-4 h-4 rounded-full bg-sky-500 flex items-center justify-center shadow-sm">
                      <Sparkles className="w-2.5 h-2.5 text-white" />
                    </div>
                  </button>

                  {/* Tray Context Menu */}
                  {trayMenuOpen && (
                    <div className="absolute bottom-8 right-0 w-48 bg-[#0d1117] border border-slate-700 rounded-lg shadow-2xl p-1 text-xs text-slate-200 z-50">
                      <button
                        onClick={() => {
                          setDockVisible(true);
                          setTrayMenuOpen(false);
                        }}
                        className="w-full text-left px-2.5 py-1.5 hover:bg-sky-600/30 rounded text-slate-200 hover:text-white"
                      >
                        Open Gemini Dock
                      </button>
                      <button
                        onClick={() => {
                          setSettingsOpen(true);
                          setTrayMenuOpen(false);
                        }}
                        className="w-full text-left px-2.5 py-1.5 hover:bg-sky-600/30 rounded text-slate-200 hover:text-white"
                      >
                        Settings & Memory
                      </button>
                      <div className="border-t border-slate-800 my-1" />
                      <button
                        onClick={() => {
                          setStartWithWindows(p => !p);
                          setTrayMenuOpen(false);
                        }}
                        className="w-full text-left px-2.5 py-1.5 hover:bg-sky-600/30 rounded flex items-center justify-between"
                      >
                        <span>Start with Windows</span>
                        {startWithWindows && <span className="text-sky-400">✓</span>}
                      </button>
                      <div className="border-t border-slate-800 my-1" />
                      <button
                        onClick={() => {
                          setDockVisible(false);
                          setTrayMenuOpen(false);
                        }}
                        className="w-full text-left px-2.5 py-1.5 hover:bg-red-500/20 text-red-400 rounded"
                      >
                        Exit GeminiOverlay
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: PRODUCTION FILES VIEWER (main.py, requirements.txt, build-release.yml) */}
        {activeTab === 'code' && (
          <div className="flex-1 flex flex-col md:flex-row bg-[#0b0f19] overflow-hidden">
            {/* Sidebar File List */}
            <div className="w-full md:w-64 border-r border-slate-800/80 bg-[#0d111a] p-4 flex flex-col justify-between">
              <div className="space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-2 block">
                  Production Deliverables
                </span>
                <button
                  onClick={() => setSelectedFile('main.py')}
                  className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                    selectedFile === 'main.py'
                      ? 'bg-sky-600 text-white shadow-md shadow-sky-600/20'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  <FileCode className="w-4 h-4 text-sky-400" />
                  <span>main.py</span>
                </button>
                <button
                  onClick={() => setSelectedFile('requirements.txt')}
                  className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                    selectedFile === 'requirements.txt'
                      ? 'bg-sky-600 text-white shadow-md shadow-sky-600/20'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  <FileCode className="w-4 h-4 text-emerald-400" />
                  <span>requirements.txt</span>
                </button>
                <button
                  onClick={() => setSelectedFile('build-release.yml')}
                  className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                    selectedFile === 'build-release.yml'
                      ? 'bg-sky-600 text-white shadow-md shadow-sky-600/20'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  <Github className="w-4 h-4 text-cyan-400" />
                  <span>build-release.yml</span>
                </button>
              </div>

              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-[11px] text-slate-400 space-y-1">
                <div className="text-slate-300 font-semibold">Features Included:</div>
                <div>• Bottom-Middle Mobile Dock</div>
                <div>• Semi-Transparent Glassmorphism</div>
                <div>• Persistent Memory Manager</div>
                <div>• Headphones/Mic Routing</div>
                <div>• DPAPI Security & Tray</div>
              </div>
            </div>

            {/* Code Content Viewer */}
            <div className="flex-1 flex flex-col bg-[#080c14] overflow-hidden">
              <div className="px-6 py-3 border-b border-slate-800/80 bg-[#0d111a] flex items-center justify-between">
                <div className="flex items-center space-x-2 text-xs font-mono text-slate-300">
                  <span className="text-slate-500">File:</span>
                  <span className="text-sky-400 font-bold">
                    {selectedFile === 'build-release.yml' ? '.github/workflows/build-release.yml' : selectedFile}
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => {
                      const content = selectedFile === 'requirements.txt' ? REQUIREMENTS_TXT : GITHUB_WORKFLOW_YML;
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
                      const content = selectedFile === 'requirements.txt' ? REQUIREMENTS_TXT : GITHUB_WORKFLOW_YML;
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
                  {selectedFile === 'main.py' && `[main.py: 850+ lines of production PyQt6 Windows desktop code is saved to disk in /main.py]`}
                </pre>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: DEVOPS & ARCHITECTURE GUIDE */}
        {activeTab === 'docs' && (
          <div className="flex-1 bg-[#0b0f19] p-8 overflow-y-auto">
            <div className="max-w-4xl mx-auto space-y-6">
              <div className="p-6 rounded-2xl bg-gradient-to-r from-sky-950/40 via-indigo-950/30 to-slate-900 border border-sky-500/20">
                <h1 className="text-xl font-bold text-white mb-2">GeminiOverlay Architectural Architecture</h1>
                <p className="text-sm text-slate-300 leading-relaxed">
                  GeminiOverlay runs as a single-instance native Windows desktop application with a floating bottom-middle dock, persistent memory management, real-time two-way voice streaming via the Google GenAI SDK, and hardware-level audio device routing.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
                  <div className="flex items-center space-x-2 text-sky-400 font-bold text-sm">
                    <Monitor className="w-4 h-4" />
                    <span>1. Bottom Dock & Glassmorphism</span>
                  </div>
                  <p className="text-slate-400 leading-relaxed">
                    Rendered with a frameless translucent bottom sheet dock anchored 25px above the Windows taskbar. During active responses, the background shifts to a semi-transparent glassmorphism look (<code className="text-sky-300 font-mono">rgba(13, 17, 23, 0.72)</code>) so underlying screen text remains readable.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
                  <div className="flex items-center space-x-2 text-emerald-400 font-bold text-sm">
                    <Brain className="w-4 h-4" />
                    <span>2. Persistent Memory Manager</span>
                  </div>
                  <p className="text-slate-400 leading-relaxed">
                    Stores custom rules and user preferences (e.g. "always address me as king") in <code className="text-emerald-300 font-mono">%APPDATA%\GeminiOverlay\memories.json</code>. Injected automatically into Gemini's system instruction on every prompt. Users can inspect, delete, and add memories inside Settings.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
                  <div className="flex items-center space-x-2 text-purple-400 font-bold text-sm">
                    <Headphones className="w-4 h-4" />
                    <span>3. Audio Device Routing</span>
                  </div>
                  <p className="text-slate-400 leading-relaxed">
                    Uses <code className="text-purple-300 font-mono">sounddevice.query_devices()</code> to discover microphones and headphones/speakers. Streams 16 kHz audio from the selected mic and outputs 24 kHz audio directly to the chosen headphones or speaker.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
                  <div className="flex items-center space-x-2 text-cyan-400 font-bold text-sm">
                    <Cpu className="w-4 h-4" />
                    <span>4. Supported Free-Tier Models</span>
                  </div>
                  <p className="text-slate-400 leading-relaxed">
                    Uses official active models <code className="text-cyan-300 font-mono">gemini-3.8-flash</code> (flagship default) and <code className="text-cyan-300 font-mono">gemini-3.5-flash-lite</code> (lightweight fallback). Deprecated models like <code className="text-red-400 font-mono">gemini-2.5-flash</code> that return 404 NOT_FOUND have been purged.
                  </p>
                </div>
              </div>

              {/* Windows Run Instructions */}
              <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
                <h3 className="font-semibold text-sm text-white">Running Locally on Windows</h3>
                <div className="space-y-2 text-xs font-mono">
                  <div className="p-2.5 rounded bg-slate-950 border border-slate-800 text-slate-300">
                    git clone &lt;repo-url&gt; && cd GeminiOverlay
                  </div>
                  <div className="p-2.5 rounded bg-slate-950 border border-slate-800 text-slate-300">
                    python -m venv venv && .\venv\Scripts\activate
                  </div>
                  <div className="p-2.5 rounded bg-slate-950 border border-slate-800 text-slate-300">
                    pip install -r requirements.txt
                  </div>
                  <div className="p-2.5 rounded bg-slate-950 border border-slate-800 text-sky-400">
                    python main.py
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
