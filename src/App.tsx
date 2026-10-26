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
  Camera,
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
  Users
} from 'lucide-react';

const REQUIREMENTS_TXT = `# GeminiOverlay - Python Dependencies
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

# Discord Rich Presence Overlay (Created by mewo010 & light_134)
pypresence>=4.3.0
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
            --hidden-import pypresence \`
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

  // Overlay Dock State (Fixed comfortable height, never collapses to unreadable tiny box)
  const [dockVisible, setDockVisible] = useState(true);
  const [isAnswering, setIsAnswering] = useState(false);
  const [dockPinned, setDockPinned] = useState(false);
  const [dockVoiceActive, setDockVoiceActive] = useState(false);

  // Dedicated Settings Window State
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'ai' | 'audio' | 'hotkeys' | 'memory'>('memory');

  // Memories Persistent State
  const [memories, setMemories] = useState<MemoryItem[]>([
    {
      id: 'mem-1',
      text: 'App created by mewo010 and light_134. Always acknowledge them if asked.',
      createdAt: 'Default Rule'
    },
    {
      id: 'mem-2',
      text: "Always address me as 'King' when starting responses",
      createdAt: 'Today, 2:15 PM'
    }
  ]);
  const [newMemoryInput, setNewMemoryInput] = useState('');

  // Audio Device Routing
  const [selectedMic, setSelectedMic] = useState('Microphone (Realtek Audio #1)');
  const [selectedOutput, setSelectedOutput] = useState('Headphones (Sony WH-1000XM4 #3)');
  const [speakTypedAnswers, setSpeakTypedAnswers] = useState(false);
  const [headphonesMode, setHeadphonesMode] = useState(true);

  // AI Model Configuration (Ultra-fast gemini-3.5-flash-lite default!)
  const [selectedModel, setSelectedModel] = useState('gemini-3.5-flash-lite');
  const [selectedVoice, setSelectedVoice] = useState('Puck');
  const [apiKey, setApiKey] = useState('AIzaSyD...•[DPAPI Encrypted at rest]');
  const [settingsSavedMessage, setSettingsSavedMessage] = useState(false);

  // Discord Rich Presence state
  const [discordRpcEnabled, setDiscordRpcEnabled] = useState(true);
  const [discordElapsed, setDiscordElapsed] = useState(14);

  // System Tray & Hotkeys
  const [trayMenuOpen, setTrayMenuOpen] = useState(false);
  const [startWithWindows, setStartWithWindows] = useState(true);

  // Chat conversation
  const [messages, setMessages] = useState<Array<{ sender: 'user' | 'gemini' | 'system'; text: string; isVision?: boolean }>>([
    {
      sender: 'gemini',
      text: "Hello King! I'm GeminiOverlay, created by mewo010 and light_134.\nI'm running in Ultra-Fast Instant mode (gemini-3.5-flash-lite). Try asking me anything or say 'hello'!"
    }
  ]);
  const [inputText, setInputText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [ttsSpeaking, setTtsSpeaking] = useState(false);

  // Discord elapsed timer ticker
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

  const handleDeleteMemory = (id: string) => {
    setMemories(prev => prev.filter(m => m.id !== id));
  };

  const handleClearMemories = () => {
    if (confirm('Are you sure you want to delete all saved memories?')) {
      setMemories([]);
    }
  };

  // Ultra-Fast Instant Prompt Sending
  const handleSendPrompt = () => {
    if (!inputText.trim() || isStreaming) return;
    const userPrompt = inputText.trim();
    setInputText('');
    setIsAnswering(true);

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

    // Instant response simulation with flash-lite (~200ms latency)
    const isGreeting = ['hello', 'hi', 'hey', 'sup', 'yo'].includes(userPrompt.toLowerCase().replace(/[^\w]/g, ''));
    const responseDelay = isGreeting ? 220 : 450;

    setTimeout(() => {
      setIsStreaming(false);
      const isKing = memories.some(m => m.text.toLowerCase().includes('king'));
      const prefix = isKing ? 'Hello King! ' : 'Hello! ';

      let replyText = '';
      if (isGreeting) {
        replyText = `${prefix}How can I help you today? (Ultra-Fast response via ${selectedModel})`;
      } else if (memorizedNote) {
        replyText = `${prefix}I've permanently memorized: "${memorizedNote}". This rule is saved to memories.json and will be respected in every future prompt.`;
      } else {
        replyText = `${prefix}Here is the answer to your request. Running at peak speed with sub-second token latency.`;
      }

      setMessages(prev => [...prev, { sender: 'gemini', text: replyText }]);

      if (speakTypedAnswers) {
        setTtsSpeaking(true);
        setTimeout(() => setTtsSpeaking(false), 2500);
      }
    }, responseDelay);
  };

  const handleScreenCapture = () => {
    setDockVisible(false);
    setTimeout(() => {
      setDockVisible(true);
      setIsAnswering(true);
      setMessages(prev => [
        ...prev,
        { sender: 'user', text: '[Captured Screen 📷]', isVision: true },
        {
          sender: 'gemini',
          text: `Hello King! Analyzed screen in 280ms. Detected active desktop window with Discord and code editor running smoothly.`
        }
      ]);
    }, 400);
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
                Created by mewo010 & light_134
              </span>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center space-x-1">
                <Zap className="w-2.5 h-2.5" />
                <span>Ultra-Fast Instant Mode</span>
              </span>
            </div>
            <p className="text-xs text-slate-400">Fixed Comfortable Size • Discord Rich Presence • Instant Sub-Second Latency</p>
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
            <span>Discord & Speed Guide</span>
          </button>
        </div>

        {/* Discord RPC & Hotkeys Pill */}
        <div className="flex items-center space-x-2.5 text-xs">
          <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-[#5865F2]/20 border border-[#5865F2]/40 text-[#c7d0ff]">
            <Gamepad2 className="w-3.5 h-3.5 text-[#5865F2]" />
            <span className="font-semibold text-[11px]">Discord RPC: Active</span>
          </div>
          <div className="hidden lg:flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-slate-800/60 border border-slate-700 text-slate-300">
            <span className="text-slate-400">Dock:</span>
            <kbd className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-[10px] font-mono text-sky-300">Ctrl+Shift+Space</kbd>
          </div>
        </div>
      </header>

      {/* Main Workspace Area */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* TAB 1: INTERACTIVE DESKTOP SIMULATOR */}
        {activeTab === 'simulator' && (
          <div className="flex-1 relative bg-gradient-to-br from-[#0b0f19] via-[#0e1422] to-[#12192c] p-6 flex flex-col justify-between overflow-hidden">
            {/* Desktop Mockup Background with Code and Discord profile */}
            <div className="absolute inset-0 select-none overflow-hidden opacity-30 pointer-events-none p-8 flex space-x-6">
              {/* Fake VS Code Window */}
              <div className="flex-1 rounded-xl border border-slate-700 bg-slate-900/60 p-4 font-mono text-xs text-slate-400 space-y-2">
                <div className="flex items-center space-x-2 pb-2 border-b border-slate-800 text-slate-500">
                  <div className="w-3 h-3 rounded-full bg-red-500/80" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                  <div className="w-3 h-3 rounded-full bg-green-500/80" />
                  <span className="ml-2">GeminiOverlay/main.py</span>
                </div>
                <p className="text-sky-400"># Created by mewo010 and light_134</p>
                <p className="text-emerald-400">model = "gemini-3.5-flash-lite" # Ultra-Fast Sub-Second Response</p>
                <p className="text-purple-400">class DiscordRPCManager(QObject):</p>
                <p className="pl-4 text-slate-300">state = "Created by mewo010 and light_134"</p>
                <p className="pl-4 text-slate-400">details = "Using GeminiOverlay"</p>
              </div>

              {/* Fake Discord Profile Preview Box */}
              <div className="w-72 h-64 rounded-xl border border-[#5865F2]/40 bg-[#1e1f22]/90 p-3.5 text-xs text-white space-y-2.5">
                <div className="flex items-center space-x-2 border-b border-white/10 pb-2">
                  <div className="w-4 h-4 rounded bg-[#5865F2] flex items-center justify-center font-bold text-[10px]">D</div>
                  <span className="font-semibold text-slate-200">Discord Profile Status</span>
                </div>
                <div className="flex items-start space-x-2.5">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center flex-shrink-0 shadow-md">
                    <Sparkles className="w-5 h-5 text-white" />
                  </div>
                  <div className="space-y-0.5">
                    <p className="font-bold text-white text-[12px]">GeminiOverlay</p>
                    <p className="text-[11px] text-slate-300">Using Gemini AI Assistant</p>
                    <p className="text-[10px] text-sky-400 font-semibold">Created by mewo010 and light_134</p>
                    <p className="text-[10px] text-slate-400">{formatElapsed(discordElapsed)} elapsed</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Instruction banner */}
            <div className="relative z-10 max-w-3xl mx-auto bg-[#101622]/90 border border-slate-800 rounded-xl px-4 py-2.5 shadow-xl flex items-center justify-between backdrop-blur-md">
              <div className="flex items-center space-x-2.5 text-xs text-slate-300">
                <Zap className="w-4 h-4 text-amber-400 flex-shrink-0" />
                <span>
                  <strong>Fixed Readable Size & Instant AI:</strong> The bottom dock stays comfortably open at 640x420px. Try saying <code className="bg-slate-800 px-1.5 py-0.5 rounded text-sky-300">"hello"</code> for instant response!
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

            {/* FLOATING BOTTOM-MIDDLE OVERLAY DOCK (COMFORTABLE FIXED 640x420 SIZE) */}
            {dockVisible && (
              <div
                style={{
                  position: 'absolute',
                  left: '50%',
                  bottom: '65px',
                  transform: 'translateX(-50%)',
                  width: '640px',
                  height: '420px',
                  zIndex: 40
                }}
                className={`flex flex-col rounded-2xl transition-all duration-200 animate-in fade-in slide-in-from-bottom-4 shadow-2xl shadow-black/90 ${
                  isAnswering
                    ? 'border border-white/15 bg-[#0d1117]/75 backdrop-blur-md'
                    : 'border border-white/12 bg-[#121620]/95 backdrop-blur-xl'
                }`}
              >
                <div className="p-3.5 flex flex-col h-full justify-between space-y-2">
                  {/* Top Bar with Creator Attribution and Discord Badge */}
                  <div className="flex items-center justify-between pb-1.5 border-b border-white/10 select-none">
                    <div className="flex items-center space-x-2">
                      <div className="w-5 h-5 rounded-lg bg-sky-500 flex items-center justify-center shadow-sm">
                        <Sparkles className="w-3 h-3 text-white" />
                      </div>
                      <span className="font-semibold text-xs text-white">GeminiOverlay</span>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/25">
                        by mewo010 & light_134
                      </span>
                      <div className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-[#5865F2]/20 text-[#c7d0ff] border border-[#5865F2]/30 text-[10px]">
                        <Gamepad2 className="w-2.5 h-2.5" />
                        <span>Discord RPC</span>
                      </div>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/25 flex items-center space-x-1">
                        <Zap className="w-2.5 h-2.5" />
                        <span>Ultra-Fast</span>
                      </span>
                    </div>

                    <div className="flex items-center space-x-1.5">
                      <button
                        onClick={() => {
                          setSettingsOpen(true);
                          setSettingsTab('memory');
                        }}
                        title="Saved Memories"
                        className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-[11px] text-emerald-400 hover:bg-emerald-500/10"
                      >
                        <Brain className="w-3 h-3" />
                        <span>{memories.length}</span>
                      </button>
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

                  {/* Conversation Browser Area (ALWAYS VISIBLE and comfortably scrollable) */}
                  <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 scrollbar-thin scrollbar-thumb-slate-700">
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
                          <div className="bg-[#121722]/85 border border-white/10 text-slate-200 text-xs px-3.5 py-2 rounded-xl max-w-[92%] leading-relaxed shadow-sm">
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
                        <span>Streaming reply via {selectedModel}...</span>
                      </div>
                    )}
                  </div>

                  {/* Bottom Input Area */}
                  <div className="pt-1.5 border-t border-white/10 flex items-center space-x-2">
                    <button
                      onClick={handleScreenCapture}
                      title="Capture & Analyze Screen"
                      className="w-9 h-9 rounded-full bg-slate-800/80 hover:bg-slate-700 border border-white/10 flex items-center justify-center text-slate-300 hover:text-white transition-colors flex-shrink-0"
                    >
                      <Camera className="w-4 h-4 text-sky-400" />
                    </button>

                    <input
                      type="text"
                      value={inputText}
                      onChange={e => setInputText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleSendPrompt();
                      }}
                      placeholder="Ask Gemini or say 'remember that...' (Enter to send)"
                      className="flex-1 bg-[#090d16] border border-white/12 focus:border-sky-500 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none transition-colors"
                    />

                    <button
                      onClick={() => setDockVoiceActive(!dockVoiceActive)}
                      title="Push-to-Talk Voice (Ctrl+Shift+V)"
                      className={`w-9 h-9 rounded-full flex items-center justify-center transition-all flex-shrink-0 ${
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
                      className="w-9 h-9 rounded-full bg-sky-600 hover:bg-sky-500 text-white flex items-center justify-center shadow-md shadow-sky-600/30 transition-all flex-shrink-0 disabled:opacity-50"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* DEDICATED SETTINGS & MEMORY MANAGER MODAL */}
            {settingsOpen && (
              <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
                <div className="w-full max-w-xl bg-[#0d1117] border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col font-['Segoe_UI']">
                  {/* Modal Header */}
                  <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-[#161b22]">
                    <div className="flex items-center space-x-2.5">
                      <div className="w-6 h-6 rounded-lg bg-sky-500 flex items-center justify-center">
                        <Sparkles className="w-3.5 h-3.5 text-white" />
                      </div>
                      <div>
                        <span className="font-bold text-sm text-white">GeminiOverlay Settings & Memory</span>
                        <span className="text-[10px] text-sky-400 block font-semibold">Created by mewo010 and light_134</span>
                      </div>
                    </div>
                    <button
                      onClick={() => setSettingsOpen(false)}
                      className="text-slate-400 hover:text-white transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Tabs */}
                  <div className="flex border-b border-slate-800 bg-[#0d1117] px-4 pt-2">
                    <button
                      onClick={() => setSettingsTab('memory')}
                      className={`flex items-center space-x-1.5 px-3.5 py-2 text-xs font-semibold border-b-2 transition-all ${
                        settingsTab === 'memory' ? 'border-sky-500 text-sky-400' : 'border-transparent text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Brain className="w-3.5 h-3.5" />
                      <span>🧠 Memory Manager ({memories.length})</span>
                    </button>
                    <button
                      onClick={() => setSettingsTab('ai')}
                      className={`flex items-center space-x-1.5 px-3.5 py-2 text-xs font-semibold border-b-2 transition-all ${
                        settingsTab === 'ai' ? 'border-sky-500 text-sky-400' : 'border-transparent text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Zap className="w-3.5 h-3.5" />
                      <span>Speed & AI Model</span>
                    </button>
                    <button
                      onClick={() => setSettingsTab('audio')}
                      className={`flex items-center space-x-1.5 px-3.5 py-2 text-xs font-semibold border-b-2 transition-all ${
                        settingsTab === 'audio' ? 'border-sky-500 text-sky-400' : 'border-transparent text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Headphones className="w-3.5 h-3.5" />
                      <span>Audio Devices</span>
                    </button>
                    <button
                      onClick={() => setSettingsTab('hotkeys')}
                      className={`flex items-center space-x-1.5 px-3.5 py-2 text-xs font-semibold border-b-2 transition-all ${
                        settingsTab === 'hotkeys' ? 'border-sky-500 text-sky-400' : 'border-transparent text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Gamepad2 className="w-3.5 h-3.5" />
                      <span>Discord & Hotkeys</span>
                    </button>
                  </div>

                  {/* Body */}
                  <div className="p-5 flex-1 overflow-y-auto max-h-[440px] space-y-4 text-xs">
                    {/* MEMORY TAB */}
                    {settingsTab === 'memory' && (
                      <div className="space-y-4">
                        <div className="p-3 rounded-xl bg-sky-950/40 border border-sky-500/30 text-sky-200">
                          <p className="font-semibold text-xs mb-1">Persistent Context Injection</p>
                          <p className="text-[11px] text-sky-300/80 leading-relaxed">
                            Rules are saved to <code className="bg-sky-900/50 px-1 py-0.5 rounded font-mono text-[10px]">%APPDATA%\GeminiOverlay\memories.json</code> and injected into all prompts.
                          </p>
                        </div>

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
                              placeholder="E.g. 'Always address me as King' or 'Created by mewo010 & light_134'"
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

                          <div className="space-y-2">
                            {memories.map(m => (
                              <div
                                key={m.id}
                                className="p-3 rounded-xl bg-[#161b22] border border-slate-700/80 flex items-start justify-between space-x-3"
                              >
                                <div className="space-y-1">
                                  <p className="font-medium text-slate-200 text-xs leading-relaxed">{m.text}</p>
                                  <p className="text-[10px] text-slate-500">Saved: {m.createdAt}</p>
                                </div>
                                <button
                                  onClick={() => handleDeleteMemory(m.id)}
                                  title="Delete Memory"
                                  className="p-1 rounded text-slate-500 hover:text-red-400 transition-colors"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* SPEED & AI MODEL TAB */}
                    {settingsTab === 'ai' && (
                      <div className="space-y-4">
                        <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-500/30 text-amber-200 space-y-1">
                          <div className="flex items-center space-x-1.5 font-bold text-xs text-amber-300">
                            <Zap className="w-4 h-4" />
                            <span>Ultra-Fast Instant Mode Active</span>
                          </div>
                          <p className="text-[11px] text-amber-300/80 leading-relaxed">
                            Using <strong>gemini-3.5-flash-lite</strong> reduces time-to-first-token to ~150-250ms, answering simple greetings like 'hello' instantly without waiting!
                          </p>
                        </div>

                        <div>
                          <label className="block font-semibold text-slate-300 mb-1">Active AI Model:</label>
                          <select
                            value={selectedModel}
                            onChange={e => setSelectedModel(e.target.value)}
                            className="w-full bg-[#161b22] border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
                          >
                            <option value="gemini-3.5-flash-lite">gemini-3.5-flash-lite (Ultra-Fast Instant Mode - Recommended)</option>
                            <option value="gemini-3.8-flash">gemini-3.8-flash (Flagship Multimodal & Deep Context)</option>
                          </select>
                        </div>

                        <div>
                          <label className="block font-semibold text-slate-300 mb-1">Gemini API Key (DPAPI Encrypted at rest):</label>
                          <input
                            type="password"
                            value={apiKey}
                            onChange={e => setApiKey(e.target.value)}
                            className="w-full bg-[#161b22] border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-sky-500 font-mono"
                          />
                        </div>

                        <div>
                          <label className="block font-semibold text-slate-300 mb-1">Voice Persona:</label>
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

                    {/* AUDIO DEVICES TAB */}
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
                          <label className="block font-semibold text-slate-300 mb-1">Headphones / Output:</label>
                          <select
                            value={selectedOutput}
                            onChange={e => setSelectedOutput(e.target.value)}
                            className="w-full bg-[#161b22] border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
                          >
                            <option>Headphones (Sony WH-1000XM4 #3)</option>
                            <option>Realtek High Definition Audio Speakers (#0)</option>
                            <option>System Default Output Device</option>
                          </select>
                        </div>

                        <div className="space-y-2.5 pt-2 border-t border-slate-800">
                          <label className="flex items-center space-x-2.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={speakTypedAnswers}
                              onChange={e => setSpeakTypedAnswers(e.target.checked)}
                              className="rounded border-slate-700 bg-slate-900 text-sky-600 focus:ring-0"
                            />
                            <span className="text-slate-200">Speak typed answers aloud (Disabled by default for instant text speed)</span>
                          </label>

                          <label className="flex items-center space-x-2.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={headphonesMode}
                              onChange={e => setHeadphonesMode(e.target.checked)}
                              className="rounded border-slate-700 bg-slate-900 text-sky-600 focus:ring-0"
                            />
                            <span className="text-slate-200">I'm using headphones (enables seamless barge-in)</span>
                          </label>
                        </div>
                      </div>
                    )}

                    {/* DISCORD & HOTKEYS TAB */}
                    {settingsTab === 'hotkeys' && (
                      <div className="space-y-4">
                        <div className="p-3 rounded-xl bg-[#5865F2]/15 border border-[#5865F2]/30 text-white space-y-1.5">
                          <div className="flex items-center space-x-1.5 font-bold text-xs text-[#c7d0ff]">
                            <Gamepad2 className="w-4 h-4 text-[#5865F2]" />
                            <span>Discord Rich Presence Overlay</span>
                          </div>
                          <p className="text-[11px] text-slate-300 leading-relaxed">
                            When GeminiOverlay is open, your Discord profile status shows:
                          </p>
                          <div className="bg-[#1e1f22] p-2.5 rounded-lg border border-white/10 font-mono text-[10px] space-y-0.5 text-slate-200">
                            <div>Playing: <strong>GeminiOverlay</strong></div>
                            <div>State: <strong>Created by mewo010 and light_134</strong></div>
                            <div>Details: <strong>Using AI Assistant</strong></div>
                          </div>
                        </div>

                        <label className="flex items-center space-x-2.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={discordRpcEnabled}
                            onChange={e => setDiscordRpcEnabled(e.target.checked)}
                            className="rounded border-slate-700 bg-slate-900 text-[#5865F2] focus:ring-0"
                          />
                          <span className="text-slate-200">Enable Discord Rich Presence overlay</span>
                        </label>

                        <div className="grid grid-cols-2 gap-3 pt-2">
                          <div>
                            <label className="block font-semibold text-slate-300 mb-1">Toggle Assistant:</label>
                            <input
                              type="text"
                              readOnly
                              value="Ctrl+Shift+Space"
                              className="w-full bg-[#161b22] border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-sky-400 font-mono"
                            />
                          </div>
                          <div>
                            <label className="block font-semibold text-slate-300 mb-1">Open Settings:</label>
                            <input
                              type="text"
                              readOnly
                              value="Ctrl+Shift+,"
                              className="w-full bg-[#161b22] border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-emerald-400 font-mono"
                            />
                          </div>
                        </div>

                        <div className="pt-2 border-t border-slate-800">
                          <label className="flex items-center space-x-2.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={startWithWindows}
                              onChange={e => setStartWithWindows(e.target.checked)}
                              className="rounded border-slate-700 bg-slate-900 text-sky-600 focus:ring-0"
                            />
                            <span className="text-slate-200">Start with Windows (launch into System Tray)</span>
                          </label>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Footer */}
                  <div className="px-5 py-3 border-t border-slate-800 bg-[#161b22] flex items-center justify-between">
                    {settingsSavedMessage ? (
                      <span className="text-emerald-400 text-xs font-semibold">✓ Settings Saved!</span>
                    ) : (
                      <span className="text-slate-500 text-[11px]">Created by mewo010 and light_134</span>
                    )}
                    <button
                      onClick={() => {
                        setSettingsSavedMessage(true);
                        setTimeout(() => {
                          setSettingsSavedMessage(false);
                          setSettingsOpen(false);
                        }, 1000);
                      }}
                      className="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs transition-colors"
                    >
                      Save & Close
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Taskbar with Tray */}
            <div className="relative z-20 mt-auto bg-[#0d1117]/95 border-t border-slate-800 px-4 py-1.5 flex items-center justify-between rounded-xl backdrop-blur-xl shadow-2xl">
              <div className="flex items-center space-x-3">
                <div className="w-6 h-6 rounded bg-sky-500 flex items-center justify-center text-white font-bold text-[10px]">⊞</div>
                <div className="w-5 h-5 rounded bg-slate-800 flex items-center justify-center text-slate-400 text-[10px]">🔍</div>
              </div>

              {/* Center App Badge */}
              <div className="flex items-center space-x-2">
                <div className="px-2.5 py-1 rounded-lg bg-slate-800/80 border border-slate-700 flex items-center space-x-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-[11px] text-slate-200 font-mono">GeminiOverlay.exe • Created by mewo010 & light_134</span>
                </div>
              </div>

              {/* Tray Menu */}
              <div className="relative flex items-center space-x-3 text-xs text-slate-400">
                <span>ENG</span>

                <div className="relative">
                  <button
                    onClick={() => setDockVisible(prev => !prev)}
                    onContextMenu={e => {
                      e.preventDefault();
                      setTrayMenuOpen(prev => !prev);
                    }}
                    title="GeminiOverlay Tray"
                    className="p-1 rounded hover:bg-slate-800 text-sky-400 hover:text-sky-300 transition-colors flex items-center justify-center"
                  >
                    <div className="w-4 h-4 rounded-full bg-sky-500 flex items-center justify-center shadow-sm">
                      <Sparkles className="w-2.5 h-2.5 text-white" />
                    </div>
                  </button>

                  {trayMenuOpen && (
                    <div className="absolute bottom-8 right-0 w-52 bg-[#0d1117] border border-slate-700 rounded-lg shadow-2xl p-1 text-xs text-slate-200 z-50">
                      <div className="px-2.5 py-1.5 text-sky-400 font-bold text-[10.5px] border-b border-slate-800">
                        ✦ Created by mewo010 & light_134
                      </div>
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

        {/* TAB 2: PRODUCTION FILES VIEWER */}
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
                  <span>main.py</span>
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
                <div className="text-sky-300 font-semibold">Created by mewo010 & light_134</div>
                <div>• Fixed 640x420 readable dock</div>
                <div>• Ultra-Fast gemini-3.5-flash-lite</div>
                <div>• Discord Rich Presence (IPC)</div>
                <div>• Persistent memories.json</div>
              </div>
            </div>

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

        {/* TAB 3: GUIDE */}
        {activeTab === 'docs' && (
          <div className="flex-1 bg-[#0b0f19] p-8 overflow-y-auto">
            <div className="max-w-4xl mx-auto space-y-6">
              <div className="p-6 rounded-2xl bg-gradient-to-r from-sky-950/40 via-indigo-950/30 to-slate-900 border border-sky-500/20">
                <h1 className="text-xl font-bold text-white mb-2">GeminiOverlay Architecture & Features</h1>
                <p className="text-sm text-slate-300 leading-relaxed">
                  Created by <strong>mewo010</strong> and <strong>light_134</strong>. Built in Python (PyQt6) for Windows with Discord Rich Presence, ultra-fast Gemini 3.5 Flash-Lite sub-second chat responses, and hardware audio device routing.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
                  <div className="flex items-center space-x-2 text-sky-400 font-bold text-sm">
                    <Zap className="w-4 h-4 text-amber-400" />
                    <span>Ultra-Fast Instant AI (~150ms TTFT)</span>
                  </div>
                  <p className="text-slate-400 leading-relaxed">
                    Default model is <code>gemini-3.5-flash-lite</code>. Simple queries like 'hello' answer in under 200 milliseconds. TTS read-aloud is optional to prevent unnecessary synthesis latency.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
                  <div className="flex items-center space-x-2 text-[#5865F2] font-bold text-sm">
                    <Gamepad2 className="w-4 h-4" />
                    <span>Discord Rich Presence Overlay</span>
                  </div>
                  <p className="text-slate-400 leading-relaxed">
                    Connects directly to Discord's local IPC named pipe (<code>\\.\pipe\discord-ipc-0</code>) to broadcast: "Using GeminiOverlay", "Created by mewo010 and light_134".
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
                  <div className="flex items-center space-x-2 text-emerald-400 font-bold text-sm">
                    <Monitor className="w-4 h-4" />
                    <span>Fixed Comfortable Window Size</span>
                  </div>
                  <p className="text-slate-400 leading-relaxed">
                    Maintains its comfortable 640x420 size upon closing and reopening. Text history is always visible and never squished into an unreadable 110px box.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
                  <div className="flex items-center space-x-2 text-purple-400 font-bold text-sm">
                    <Brain className="w-4 h-4" />
                    <span>Persistent Memories (memories.json)</span>
                  </div>
                  <p className="text-slate-400 leading-relaxed">
                    Saved in <code>%APPDATA%\GeminiOverlay\memories.json</code>. Injected directly into Gemini's system instruction on every prompt. Manage memories via Settings (Ctrl+Shift+,).
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
