/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Bot,
  User,
  Code2,
  Image as ImageIcon,
  Send,
  Paperclip,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Copy,
  Check,
  Trash2,
  ChevronDown,
  Menu,
  X,
  FileText,
  MessageSquare,
  CornerDownLeft,
  ArrowUp,
  History,
  FolderKanban,
  Download,
  AlertCircle,
  Eye,
  Terminal,
  Zap,
} from 'lucide-react';

interface Attachment {
  name: string;
  size: number;
  mimeType: string;
  data: string; // base64 without prefix or with prefix
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  image?: string;
  attachments?: Attachment[];
  timestamp: string;
}

type Mode = 'chat' | 'history' | 'files' | 'code' | 'image' | 'reply';

export default function App() {
  const [mode, setMode] = useState<Mode>('chat');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [expertMode, setExpertMode] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [apiStatus, setApiStatus] = useState<{ configured: boolean; model: string; provider?: string }>({
    configured: false,
    model: 'gemini-3.8-flash',
  });
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [audioLoadingId, setAudioLoadingId] = useState<string | null>(null);
  const [showClearModal, setShowClearModal] = useState(false);
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState('gemini-3.8-flash');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const recognitionRef = useRef<any>(null);

  // Load chat history from localStorage on initial mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('abs_chat_history');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
        }
      }
    } catch (e) {
      console.warn('Could not load chat history:', e);
    }
    checkHealth();
  }, []);

  // Save chat history to localStorage whenever messages change
  useEffect(() => {
    if (messages.length > 0) {
      try {
        localStorage.setItem('abs_chat_history', JSON.stringify(messages));
      } catch (e) {
        console.warn('Failed saving messages to localStorage:', e);
      }
    }
  }, [messages]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const checkHealth = async () => {
    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        const data = await res.json();
        setApiStatus(data);
      }
    } catch {
      setApiStatus({ configured: false, model: 'gemini-3.8-flash' });
    }
  };

  // Setup Web Speech Recognition
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const rec = new SpeechRecognition();
      rec.continuous = false;
      rec.interimResults = true;
      rec.lang = 'en-US';

      rec.onresult = (event: any) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          transcript += event.results[i][0].transcript;
        }
        setInput((prev) => (prev ? prev + ' ' + transcript : transcript));
      };

      rec.onerror = () => {
        setIsRecording(false);
      };

      rec.onend = () => {
        setIsRecording(false);
      };

      recognitionRef.current = rec;
    }
  }, []);

  const toggleRecording = () => {
    if (!recognitionRef.current) {
      alertFallback('Voice input is not supported in this browser. Please try Chrome or Edge.');
      return;
    }
    if (isRecording) {
      recognitionRef.current.stop();
      setIsRecording(false);
    } else {
      try {
        recognitionRef.current.start();
        setIsRecording(true);
      } catch (err) {
        console.warn('Speech recognition error:', err);
      }
    }
  };

  const alertFallback = (msg: string) => {
    // Graceful custom inline notification instead of window.alert
    const notice = document.createElement('div');
    notice.className =
      'fixed bottom-6 right-6 bg-[#211725] border border-[#a95bc9] text-[#f7f0fa] px-4 py-3 rounded-xl shadow-2xl z-50 text-sm max-w-sm transition-opacity duration-300';
    notice.textContent = msg;
    document.body.appendChild(notice);
    setTimeout(() => {
      notice.style.opacity = '0';
      setTimeout(() => notice.remove(), 300);
    }, 4000);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64Data = result.split(',')[1] || '';
        setAttachments((prev) => [
          ...prev,
          {
            name: file.name,
            size: file.size,
            mimeType: file.type || 'text/plain',
            data: base64Data,
          },
        ]);
      };
      reader.readAsDataURL(file);
    });
    // Reset file input value so same file can be selected again
    e.target.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend !== undefined ? textToSend : input).trim();
    if (!text && attachments.length === 0) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text || 'Please inspect the attached file(s).',
      attachments: [...attachments],
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    const sendingAttachments = [...attachments];
    setAttachments([]);
    setIsLoading(true);

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    try {
      const historyPayload = messages.slice(-8).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage.content,
          mode,
          expert: expertMode,
          history: historyPayload,
          attachments: sendingAttachments,
          model: selectedModel,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Server responded with status ${res.status}`);
      }

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.text || 'Done.',
        image: data.image || undefined,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err: any) {
      let messageContent = err?.message || 'An unexpected network error occurred.';
      
      // Only append API key instructions if the error specifically relates to missing API keys
      if (messageContent.toLowerCase().includes('not configured') || messageContent.toLowerCase().includes('api_key')) {
        messageContent = `${messageContent}\n\n*Please ensure your GEMINI_API_KEY is configured in your Netlify site settings (Site configuration > Environment variables) and you have triggered a new deploy.*`;
      }

      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: messageContent,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
      checkHealth();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
  };

  const handleNewChat = () => {
    setMessages([]);
    localStorage.removeItem('abs_chat_history');
    setAttachments([]);
    setInput('');
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleSpeak = async (msgId: string, text: string) => {
    if (playingAudioId === msgId) {
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      }
      setPlayingAudioId(null);
      return;
    }

    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }

    setAudioLoadingId(msgId);
    try {
      const res = await fetch('/api/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (res.ok && data.audio) {
        const audio = new Audio(data.audio);
        currentAudioRef.current = audio;
        setPlayingAudioId(msgId);
        audio.onended = () => {
          setPlayingAudioId(null);
          currentAudioRef.current = null;
        };
        audio.play();
      } else {
        alertFallback('Text-to-speech failed: ' + (data.error || 'Server error'));
      }
    } catch (err: any) {
      alertFallback('Could not generate speech: ' + err.message);
    } finally {
      setAudioLoadingId(null);
    }
  };

  const placeholderByMode: Record<Mode, string> = {
    chat: 'Ask anything... Explore ideas, solve challenges, or learn something new.',
    code: 'Describe code you need, paste an error snippet, or ask for refactoring...',
    image: 'Describe a scene or visual prompt for Image Studio...',
    reply: 'Paste an email or message to draft replies in multiple styles...',
    files: 'Ask questions about your uploaded documents or data...',
    history: 'Browse or search your current session messages...',
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#100b13] text-[#f7f0fa] selection:bg-[#b45ae5] selection:text-white">
      {/* Sidebar Desktop */}
      <aside className="hidden md:flex w-[240px] flex-shrink-0 flex-col border-r border-[#302333] bg-[#09060c] p-3.5 select-none">
        {/* Brand */}
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#f1b5ff] via-[#b45ae5] to-[#7526a0] font-black text-[#150a1b] shadow-[0_0_20px_rgba(180,90,229,0.45)]">
            A
          </div>
          <div className="flex flex-col">
            <span className="text-[15px] font-extrabold tracking-tight text-white">Abs AI</span>
            <span className="text-[9px] font-semibold tracking-wider text-[#b4a4b9]">CREATIVE INTELLIGENCE</span>
          </div>
        </div>

        {/* New Chat Button */}
        <button
          onClick={handleNewChat}
          className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-[#3f2a48] bg-[#1d1423] px-3.5 py-2.5 text-xs font-semibold text-[#f7f0fa] shadow-sm transition hover:border-[#b45ae5] hover:bg-[#2c1b37] hover:shadow-[0_0_15px_rgba(180,90,229,0.2)] active:scale-95"
        >
          <Sparkles className="h-3.5 w-3.5 text-[#e0a0fa]" />
          <span>New Chat</span>
        </button>

        {/* Features Section */}
        <div className="mt-5 px-2 text-[10px] font-bold uppercase tracking-widest text-[#8e7a96]">
          Features
        </div>
        <div className="mt-1 flex flex-col gap-1">
          <button
            onClick={() => setMode('chat')}
            className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition ${
              mode === 'chat'
                ? 'border border-[#4c2f57] bg-[#24182a] text-white shadow-sm'
                : 'text-[#d0c3d4] hover:bg-[#1a121f] hover:text-white'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5 text-[#e0a0fa]" />
            <span>Chat</span>
          </button>
          <button
            onClick={() => setMode('history')}
            className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition ${
              mode === 'history'
                ? 'border border-[#4c2f57] bg-[#24182a] text-white shadow-sm'
                : 'text-[#d0c3d4] hover:bg-[#1a121f] hover:text-white'
            }`}
          >
            <History className="h-3.5 w-3.5 text-[#d9a1f3]" />
            <span>Archived ({messages.length})</span>
          </button>
          <button
            onClick={() => {
              setMode('files');
              fileInputRef.current?.click();
            }}
            className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition ${
              mode === 'files'
                ? 'border border-[#4c2f57] bg-[#24182a] text-white shadow-sm'
                : 'text-[#d0c3d4] hover:bg-[#1a121f] hover:text-white'
            }`}
          >
            <FileText className="h-3.5 w-3.5 text-[#d9a1f3]" />
            <span>Library / Files</span>
          </button>
        </div>

        {/* Workspaces Section */}
        <div className="mt-5 px-2 text-[10px] font-bold uppercase tracking-widest text-[#8e7a96]">
          Workspaces
        </div>
        <div className="mt-1 flex flex-col gap-1">
          <button
            onClick={() => setMode('code')}
            className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition ${
              mode === 'code'
                ? 'border border-[#4c2f57] bg-[#24182a] text-white shadow-sm'
                : 'text-[#d0c3d4] hover:bg-[#1a121f] hover:text-white'
            }`}
          >
            <Code2 className="h-3.5 w-3.5 text-[#9ed3ff]" />
            <span>Code Assistant</span>
          </button>
          <button
            onClick={() => setMode('image')}
            className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition ${
              mode === 'image'
                ? 'border border-[#4c2f57] bg-[#24182a] text-white shadow-sm'
                : 'text-[#d0c3d4] hover:bg-[#1a121f] hover:text-white'
            }`}
          >
            <ImageIcon className="h-3.5 w-3.5 text-[#f5a6dc]" />
            <span>Image Studio</span>
          </button>
          <button
            onClick={() => setMode('reply')}
            className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition ${
              mode === 'reply'
                ? 'border border-[#4c2f57] bg-[#24182a] text-white shadow-sm'
                : 'text-[#d0c3d4] hover:bg-[#1a121f] hover:text-white'
            }`}
          >
            <CornerDownLeft className="h-3.5 w-3.5 text-[#ffe082]" />
            <span>Reply Writer</span>
          </button>
        </div>

        {/* Sidebar Footer */}
        <div className="mt-auto border-t border-[#2b202e] pt-3 text-[11px] text-[#9d8ba3]">
          <div className="flex items-center gap-1.5 font-medium text-[#cbb2d4]">
            <div className={`h-2 w-2 rounded-full ${apiStatus.configured ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-amber-400'}`} />
            <span>{apiStatus.configured ? 'Gemini API Active' : 'API Initializing'}</span>
          </div>
          <div className="mt-1 text-[10px] text-[#7d6b82]">
            Made by Ankit · Powered by Gemini
          </div>
        </div>
      </aside>

      {/* Main Area */}
      <main className="relative flex flex-1 flex-col overflow-hidden bg-gradient-to-br from-[#201224] via-[#120a16] to-[#0a060d]">
        {/* Top Header */}
        <header className="flex h-14 items-center justify-between border-b border-[#3b293e]/60 bg-[#140c18]/80 px-4 backdrop-blur-md">
          {/* Left Header: Mobile Toggle & Model Selector */}
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#3e2c44] bg-[#1a1120] text-[#e0d0e6] md:hidden"
            >
              <Menu className="h-4 w-4" />
            </button>

            {/* Model Pill Dropdown */}
            <div className="relative">
              <button
                onClick={() => setModelSelectorOpen(!modelSelectorOpen)}
                className="flex items-center gap-1.5 rounded-lg border border-[#48344d] bg-[#100b14] px-3 py-1.5 text-xs font-semibold text-[#eee1f3] transition hover:border-[#b45ae5]"
              >
                <Sparkles className="h-3.5 w-3.5 text-[#e0a0fa]" />
                <span>{selectedModel === 'gemini-3.8-flash' ? 'Gemini 3.8 Flash' : 'Gemini 3.1 Pro'}</span>
                <ChevronDown className="h-3 w-3 text-[#9f8ca6]" />
              </button>

              {modelSelectorOpen && (
                <div className="absolute left-0 top-full z-40 mt-1.5 w-60 rounded-xl border border-[#4d3454] bg-[#1b1221] p-1.5 shadow-2xl backdrop-blur-xl">
                  <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[#9d8ba3]">
                    Active Intelligence Engine
                  </div>
                  <button
                    onClick={() => {
                      setSelectedModel('gemini-3.8-flash');
                      setModelSelectorOpen(false);
                    }}
                    className={`flex w-full flex-col rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                      selectedModel === 'gemini-3.8-flash'
                        ? 'bg-[#311c3c] text-white font-medium'
                        : 'text-[#d0c3d4] hover:bg-[#25172d]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">Gemini 3.8 Flash</span>
                      <span className="rounded bg-[#a95bc9]/30 px-1.5 py-0.2 text-[9px] text-[#e4b2ff]">Recommended</span>
                    </div>
                    <span className="text-[10px] text-[#a491aa]">Blazing fast, high throughput & multimodal</span>
                  </button>
                  <button
                    onClick={() => {
                      setSelectedModel('gemini-3.1-pro-preview');
                      setModelSelectorOpen(false);
                    }}
                    className={`mt-1 flex w-full flex-col rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                      selectedModel === 'gemini-3.1-pro-preview'
                        ? 'bg-[#311c3c] text-white font-medium'
                        : 'text-[#d0c3d4] hover:bg-[#25172d]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">Gemini 3.1 Pro</span>
                      <span className="text-[9px] text-[#baa4c0]">Deep STEM & Code</span>
                    </div>
                    <span className="text-[10px] text-[#a491aa]">Advanced multi-turn reasoning</span>
                  </button>
                </div>
              )}
            </div>

            {/* Mode Tag */}
            <div className="hidden sm:flex items-center gap-1 rounded-md border border-[#3e2c44] bg-[#1a1220]/60 px-2 py-1 text-[11px] text-[#bda9c3]">
              <span className="capitalize">{mode}</span>
            </div>
          </div>

          {/* Right Header Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowClearModal(true)}
              className="flex items-center gap-1.5 rounded-lg border border-[#49324f] bg-[#100b13] px-2.5 py-1.5 text-xs font-medium text-[#d9c8de] transition hover:border-[#b45ae5] hover:text-white"
            >
              <Trash2 className="h-3 w-3 text-[#d091db]" />
              <span className="hidden sm:inline">Clear Chat</span>
            </button>

            <button
              onClick={() => setExpertMode(!expertMode)}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${
                expertMode
                  ? 'border-[#c05be3] bg-gradient-to-r from-[#5a216b] to-[#3f194d] text-white shadow-[0_0_12px_rgba(192,91,227,0.4)]'
                  : 'border-[#49324f] bg-[#100b13] text-[#d9c8de] hover:border-[#b45ae5]'
              }`}
            >
              <Zap className={`h-3 w-3 ${expertMode ? 'text-amber-300' : 'text-[#d9a1f3]'}`} />
              <span>{expertMode ? 'Expert Active' : 'Expert'}</span>
            </button>
          </div>
        </header>

        {/* Conversation / Hero Container */}
        <div className="flex-1 overflow-y-auto px-3 py-4 md:px-6">
          {messages.length === 0 ? (
            /* Hero Welcome Screen */
            <div className="flex min-h-[75vh] flex-col items-center justify-center text-center">
              {/* Glowing Orb */}
              <div className="animate-orb relative mb-5 flex h-16 w-16 items-center justify-center rounded-full border border-[#e4a8f8]/60 bg-gradient-to-br from-[#f8d0ff] via-[#ab47d8] to-[#250d32]">
                <Sparkles className="h-8 w-8 text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.8)]" />
              </div>

              <h1 className="text-2xl font-bold tracking-tight sm:text-4xl">
                Ready to{' '}
                <span className="bg-gradient-to-r from-[#f1b5ff] via-[#c689ff] to-[#f5a6dc] bg-clip-text text-transparent">
                  Create Something New?
                </span>
              </h1>
              <p className="mt-2.5 max-w-lg text-xs sm:text-sm text-[#bda9c3]">
                Ask anything. Explore ideas, create visual concepts, write robust code, analyze documents, and spark next-generation creativity.
              </p>

              {/* Action Cards */}
              <div className="mt-8 grid w-full max-w-2xl grid-cols-1 gap-2.5 sm:grid-cols-2">
                <button
                  onClick={() => {
                    setMode('code');
                    handleSendMessage('Write a modern TypeScript utility function with full test cases and clean documentation.');
                  }}
                  className="flex flex-col rounded-xl border border-[#3d2c42] bg-[#120a16]/90 p-3.5 text-left transition hover:border-[#ba66d7] hover:bg-[#22132a] hover:shadow-[0_4px_20px_rgba(186,102,215,0.15)] group"
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#2c1933] text-[#9ed3ff] group-hover:scale-110 transition">
                    <Code2 className="h-4 w-4" />
                  </div>
                  <strong className="mt-2.5 text-xs font-semibold text-white">Dev Assistant</strong>
                  <span className="mt-1 text-[11px] leading-relaxed text-[#b6a5bc]">
                    Generate production-grade code, debug snippets, and inspect architectures.
                  </span>
                </button>

                <button
                  onClick={() => {
                    setMode('image');
                    handleSendMessage('Create a prompt for a hyper-realistic cinematic neon cyberpunk metropolis at twilight.');
                  }}
                  className="flex flex-col rounded-xl border border-[#3d2c42] bg-[#120a16]/90 p-3.5 text-left transition hover:border-[#ba66d7] hover:bg-[#22132a] hover:shadow-[0_4px_20px_rgba(186,102,215,0.15)] group"
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#2c1933] text-[#f5a6dc] group-hover:scale-110 transition">
                    <ImageIcon className="h-4 w-4" />
                  </div>
                  <strong className="mt-2.5 text-xs font-semibold text-white">Image Studio</strong>
                  <span className="mt-1 text-[11px] leading-relaxed text-[#b6a5bc]">
                    Craft visual descriptions, color palettes, and SVG vector illustrations.
                  </span>
                </button>

                <button
                  onClick={() => {
                    setMode('reply');
                    handleSendMessage('Craft 3 reply options for a client asking for a project estimate timeline.');
                  }}
                  className="flex flex-col rounded-xl border border-[#3d2c42] bg-[#120a16]/90 p-3.5 text-left transition hover:border-[#ba66d7] hover:bg-[#22132a] hover:shadow-[0_4px_20px_rgba(186,102,215,0.15)] group"
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#2c1933] text-[#ffe082] group-hover:scale-110 transition">
                    <CornerDownLeft className="h-4 w-4" />
                  </div>
                  <strong className="mt-2.5 text-xs font-semibold text-white">Reply Writer</strong>
                  <span className="mt-1 text-[11px] leading-relaxed text-[#b6a5bc]">
                    Draft charismatic, persuasive, or diplomatic emails and messages.
                  </span>
                </button>

                <button
                  onClick={() => {
                    setMode('files');
                    fileInputRef.current?.click();
                  }}
                  className="flex flex-col rounded-xl border border-[#3d2c42] bg-[#120a16]/90 p-3.5 text-left transition hover:border-[#ba66d7] hover:bg-[#22132a] hover:shadow-[0_4px_20px_rgba(186,102,215,0.15)] group"
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#2c1933] text-[#b45ae5] group-hover:scale-110 transition">
                    <FileText className="h-4 w-4" />
                  </div>
                  <strong className="mt-2.5 text-xs font-semibold text-white">Analyze Documents</strong>
                  <span className="mt-1 text-[11px] leading-relaxed text-[#b6a5bc]">
                    Attach PDFs, spreadsheets, or images for deep comprehension and insights.
                  </span>
                </button>
              </div>
            </div>
          ) : (
            /* Chat Messages List */
            <div className="mx-auto flex max-w-3xl flex-col gap-5 pb-6">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {/* Assistant Avatar */}
                  {msg.role === 'assistant' && (
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#e8b0ff] to-[#8d3db6] text-xs font-black text-[#190c21] shadow-[0_0_15px_rgba(180,90,229,0.3)]">
                      A
                    </div>
                  )}

                  {/* Message Bubble */}
                  <div
                    className={`relative max-w-[85%] rounded-2xl px-4 py-3 sm:max-w-[78%] ${
                      msg.role === 'user'
                        ? 'border border-[#55316a] bg-[#2d1936] text-[#f7f0fa]'
                        : 'border border-[#3d2b42] bg-[#1a1120]/90 text-[#eee1f3]'
                    }`}
                  >
                    {/* User Attachments Display */}
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="mb-2.5 flex flex-wrap gap-1.5 border-b border-[#ffffff15] pb-2">
                        {msg.attachments.map((att, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-1.5 rounded-md border border-[#5d3b6e] bg-[#201227] px-2 py-1 text-[11px] text-[#e0cfeb]"
                          >
                            <FileText className="h-3 w-3 text-[#d9a1f3]" />
                            <span className="max-w-[140px] truncate">{att.name}</span>
                            <span className="text-[9px] text-[#9a86a1]">({formatFileSize(att.size)})</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Message Body with Markdown Parser */}
                    <div className="text-xs sm:text-sm leading-relaxed">
                      <MarkdownViewer content={msg.content} />
                    </div>

                    {/* AI Generated Image Preview */}
                    {msg.image && (
                      <div className="mt-3 overflow-hidden rounded-xl border border-[#684471]">
                        <img
                          src={msg.image}
                          alt="AI Generated"
                          className="max-h-[420px] w-full object-contain bg-black/40"
                        />
                        <div className="flex items-center justify-between bg-[#150d1a] px-3 py-1.5 text-[11px] text-[#c0a9cb]">
                          <span>Generated by Gemini</span>
                          <a
                            href={msg.image}
                            download="abs-ai-image.png"
                            className="flex items-center gap-1 text-[#e0a0fa] hover:underline"
                          >
                            <Download className="h-3 w-3" />
                            <span>Save Image</span>
                          </a>
                        </div>
                      </div>
                    )}

                    {/* Assistant Message Action Toolbar */}
                    {msg.role === 'assistant' && (
                      <div className="mt-3 flex items-center gap-2 border-t border-[#ffffff0d] pt-2 text-[11px] text-[#9d8ba3]">
                        {/* Copy Button */}
                        <button
                          onClick={() => copyToClipboard(msg.content, msg.id)}
                          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 transition hover:bg-[#281831] hover:text-[#f7f0fa]"
                          title="Copy text"
                        >
                          {copiedId === msg.id ? (
                            <>
                              <Check className="h-3 w-3 text-emerald-400" />
                              <span className="text-emerald-400">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>

                        {/* Read Aloud Voice Button */}
                        <button
                          onClick={() => handleSpeak(msg.id, msg.content)}
                          className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 transition hover:bg-[#281831] ${
                            playingAudioId === msg.id ? 'text-[#e0a0fa] font-semibold' : 'hover:text-[#f7f0fa]'
                          }`}
                          title="Speak answer"
                        >
                          {audioLoadingId === msg.id ? (
                            <span className="animate-spin text-xs">↻</span>
                          ) : playingAudioId === msg.id ? (
                            <VolumeX className="h-3 w-3 text-[#e0a0fa]" />
                          ) : (
                            <Volume2 className="h-3 w-3" />
                          )}
                          <span>{playingAudioId === msg.id ? 'Stop Voice' : 'Speak'}</span>
                        </button>

                        <span className="ml-auto text-[10px] text-[#7d6b82]">{msg.timestamp}</span>
                      </div>
                    )}
                  </div>

                  {/* User Avatar */}
                  {msg.role === 'user' && (
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-[#4d255d] text-xs font-bold text-white shadow-sm">
                      <User className="h-4 w-4" />
                    </div>
                  )}
                </div>
              ))}

              {/* Loading Indicator */}
              {isLoading && (
                <div className="flex items-start gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#e8b0ff] to-[#8d3db6] text-xs font-black text-[#190c21] animate-pulse">
                    A
                  </div>
                  <div className="flex items-center gap-2 rounded-2xl border border-[#3d2b42] bg-[#1a1120]/90 px-4 py-3 text-xs text-[#d0c3d4]">
                    <div className="flex gap-1">
                      <div className="h-2 w-2 rounded-full bg-[#e0a0fa] animate-bounce [animation-delay:-0.3s]" />
                      <div className="h-2 w-2 rounded-full bg-[#b45ae5] animate-bounce [animation-delay:-0.15s]" />
                      <div className="h-2 w-2 rounded-full bg-[#8d3db6] animate-bounce" />
                    </div>
                    <span>Abs AI is synthesizing...</span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Composer Section */}
        <div className="relative border-t border-[#342438]/80 bg-[#120a16]/95 px-3 py-3 backdrop-blur-xl md:px-6">
          <div className="mx-auto max-w-3xl">
            {/* Attached files preview chips */}
            {attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {attachments.map((file, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-1.5 rounded-lg border border-[#52335f] bg-[#221329] px-2.5 py-1 text-xs text-[#eedcf5]"
                  >
                    <FileText className="h-3.5 w-3.5 text-[#e0a0fa]" />
                    <span className="max-w-[180px] truncate">{file.name}</span>
                    <span className="text-[10px] text-[#9c89a3]">({formatFileSize(file.size)})</span>
                    <button
                      onClick={() => removeAttachment(idx)}
                      className="ml-1 rounded p-0.5 hover:bg-[#3d2449] hover:text-rose-400"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Main Composer Box */}
            <div className="rounded-2xl border border-[#5b3c66] bg-[#1a1220] p-2.5 shadow-xl transition-all focus-within:border-[#b45ae5] focus-within:shadow-[0_0_25px_rgba(180,90,229,0.25)]">
              {/* Quick Workspace Switcher Tools */}
              <div className="mb-2 flex flex-wrap items-center gap-1.5 border-b border-[#ffffff0f] pb-2 text-xs">
                <button
                  onClick={() => setMode('chat')}
                  className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition ${
                    mode === 'chat'
                      ? 'border border-[#753d8a] bg-[#422250] text-white'
                      : 'text-[#baa7be] hover:bg-[#25182d] hover:text-white'
                  }`}
                >
                  <Sparkles className="h-3 w-3 text-[#e0a0fa]" />
                  <span>Ask Anything</span>
                </button>

                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-[#baa7be] transition hover:bg-[#25182d] hover:text-white"
                >
                  <Paperclip className="h-3 w-3 text-[#d9a1f3]" />
                  <span>Attach File</span>
                </button>

                <button
                  onClick={() => setMode('image')}
                  className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition ${
                    mode === 'image'
                      ? 'border border-[#753d8a] bg-[#422250] text-white'
                      : 'text-[#baa7be] hover:bg-[#25182d] hover:text-white'
                  }`}
                >
                  <ImageIcon className="h-3 w-3 text-[#f5a6dc]" />
                  <span>Create Image</span>
                </button>

                <button
                  onClick={() => setMode('code')}
                  className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition ${
                    mode === 'code'
                      ? 'border border-[#753d8a] bg-[#422250] text-white'
                      : 'text-[#baa7be] hover:bg-[#25182d] hover:text-white'
                  }`}
                >
                  <Code2 className="h-3 w-3 text-[#9ed3ff]" />
                  <span>Generate Code</span>
                </button>

                <button
                  onClick={() => setMode('reply')}
                  className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition ${
                    mode === 'reply'
                      ? 'border border-[#753d8a] bg-[#422250] text-white'
                      : 'text-[#baa7be] hover:bg-[#25182d] hover:text-white'
                  }`}
                >
                  <CornerDownLeft className="h-3 w-3 text-[#ffe082]" />
                  <span>Reply Writer</span>
                </button>
              </div>

              {/* Textarea & Send Controls */}
              <div className="flex items-end gap-2">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={handleTextareaInput}
                  onKeyDown={handleKeyDown}
                  rows={1}
                  placeholder={placeholderByMode[mode]}
                  className="max-h-[140px] min-h-[36px] flex-1 resize-none bg-transparent px-2 py-1.5 text-xs sm:text-sm text-[#f7f0fa] placeholder-[#95819d] outline-none"
                />

                {/* Microphone Button */}
                <button
                  onClick={toggleRecording}
                  type="button"
                  title={isRecording ? 'Stop listening' : 'Voice input'}
                  className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border transition ${
                    isRecording
                      ? 'border-red-500 bg-red-600/30 text-red-300 animate-pulse'
                      : 'border-[#49324f] bg-[#24152a] text-[#dbcae1] hover:border-[#b45ae5] hover:text-white'
                  }`}
                >
                  {isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </button>

                {/* Send Button */}
                <button
                  onClick={() => handleSendMessage()}
                  disabled={isLoading || (!input.trim() && attachments.length === 0)}
                  type="button"
                  aria-label="Send message"
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#f1b5ff] via-[#b45ae5] to-[#8d3db6] text-[#1a0a22] font-black shadow-[0_0_15px_rgba(180,90,229,0.35)] transition hover:scale-105 active:scale-95 disabled:opacity-40 disabled:hover:scale-100"
                >
                  <ArrowUp className="h-5 w-5 stroke-[2.5]" />
                </button>
              </div>

              {/* Helper notice */}
              <div className="mt-1.5 flex items-center justify-between px-1 text-[10px] text-[#86738c]">
                <span>Press Enter to send, Shift + Enter for new line</span>
                <span>
                  {apiStatus.configured ? 'Connected to Gemini API' : 'Checking connection...'}
                </span>
              </div>
            </div>

            {/* Hidden File Input */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              multiple
              accept="image/png,image/jpeg,image/webp,image/gif,.txt,.md,.pdf,.docx,.csv,.json,.ts,.tsx,.js,.jsx,.py"
              className="hidden"
            />
          </div>
        </div>

        {/* Clear History Confirmation Modal */}
        {showClearModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-2xl border border-[#4d3254] bg-[#1a1120] p-5 shadow-2xl">
              <div className="flex items-center gap-2.5 text-rose-400">
                <Trash2 className="h-5 w-5" />
                <h3 className="font-bold text-white">Clear Conversation?</h3>
              </div>
              <p className="mt-2 text-xs text-[#b8a4be]">
                This will delete the messages in this session. Saved chats in your browser will be cleared.
              </p>
              <div className="mt-5 flex justify-end gap-2 text-xs">
                <button
                  onClick={() => setShowClearModal(false)}
                  className="rounded-lg border border-[#432d4a] bg-[#221629] px-3.5 py-2 font-medium text-[#d9c9df] hover:bg-[#2d1c37]"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    handleNewChat();
                    setShowClearModal(false);
                  }}
                  className="rounded-lg bg-rose-600 px-3.5 py-2 font-semibold text-white hover:bg-rose-500 shadow-md"
                >
                  Clear All
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Mobile Sidebar Drawer */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 flex md:hidden">
            <div
              className="fixed inset-0 bg-black/70 backdrop-blur-sm"
              onClick={() => setMobileMenuOpen(false)}
            />
            <div className="relative flex w-[260px] flex-col border-r border-[#302333] bg-[#09060c] p-4 text-white">
              <div className="flex items-center justify-between pb-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-[#f1b5ff] to-[#8d3db6] font-black text-[#150a1b]">
                    A
                  </div>
                  <span className="font-bold">Abs AI</span>
                </div>
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="rounded-lg p-1 text-[#bda9c3] hover:bg-[#201526]"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <button
                onClick={() => {
                  handleNewChat();
                  setMobileMenuOpen(false);
                }}
                className="mt-3 flex items-center justify-center gap-2 rounded-xl border border-[#3f2a48] bg-[#1d1423] p-2.5 text-xs font-semibold"
              >
                <Sparkles className="h-3.5 w-3.5 text-[#e0a0fa]" />
                <span>New Chat</span>
              </button>

              <div className="mt-4 flex flex-col gap-1 text-xs">
                <button
                  onClick={() => {
                    setMode('chat');
                    setMobileMenuOpen(false);
                  }}
                  className="flex items-center gap-2 rounded-lg p-2 hover:bg-[#1f1526]"
                >
                  <Sparkles className="h-3.5 w-3.5 text-[#e0a0fa]" />
                  <span>Chat</span>
                </button>
                <button
                  onClick={() => {
                    setMode('code');
                    setMobileMenuOpen(false);
                  }}
                  className="flex items-center gap-2 rounded-lg p-2 hover:bg-[#1f1526]"
                >
                  <Code2 className="h-3.5 w-3.5 text-[#9ed3ff]" />
                  <span>Code Assistant</span>
                </button>
                <button
                  onClick={() => {
                    setMode('image');
                    setMobileMenuOpen(false);
                  }}
                  className="flex items-center gap-2 rounded-lg p-2 hover:bg-[#1f1526]"
                >
                  <ImageIcon className="h-3.5 w-3.5 text-[#f5a6dc]" />
                  <span>Image Studio</span>
                </button>
                <button
                  onClick={() => {
                    setMode('reply');
                    setMobileMenuOpen(false);
                  }}
                  className="flex items-center gap-2 rounded-lg p-2 hover:bg-[#1f1526]"
                >
                  <CornerDownLeft className="h-3.5 w-3.5 text-[#ffe082]" />
                  <span>Reply Writer</span>
                </button>
                <button
                  onClick={() => {
                    setMode('files');
                    fileInputRef.current?.click();
                    setMobileMenuOpen(false);
                  }}
                  className="flex items-center gap-2 rounded-lg p-2 hover:bg-[#1f1526]"
                >
                  <FileText className="h-3.5 w-3.5 text-[#d9a1f3]" />
                  <span>Library / Files</span>
                </button>
              </div>

              <div className="mt-auto border-t border-[#291c2c] pt-3 text-[11px] text-[#9a86a1]">
                <div>Made by Ankit · Powered by Gemini</div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

/**
 * Lightweight Markdown Viewer supporting code syntax styling, copy-code button,
 * headers, lists, bold text, and SVG rendering.
 */
function MarkdownViewer({ content }: { content: string }) {
  if (!content) return null;

  // Split content by code blocks ```...```
  const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    const textBefore = content.substring(lastIndex, match.index);
    if (textBefore) {
      parts.push(<TextMarkdown key={lastIndex} text={textBefore} />);
    }

    const language = match[1] || 'plaintext';
    const code = match[2];
    parts.push(
      <CodeBlock key={match.index} language={language} code={code} />
    );
    lastIndex = match.index + match[0].length;
  }

  const remaining = content.substring(lastIndex);
  if (remaining) {
    parts.push(<TextMarkdown key={lastIndex} text={remaining} />);
  }

  return <div className="space-y-2">{parts}</div>;
}

/**
 * Render standard markdown text: bold, headers, list items, inline code.
 */
function TextMarkdown({ text }: { text: string }) {
  const lines = text.split('\n');

  return (
    <div className="space-y-1.5 leading-relaxed">
      {lines.map((line, idx) => {
        const trimmed = line.trim();

        // Headers
        if (trimmed.startsWith('### ')) {
          return (
            <h4 key={idx} className="mt-3 text-xs sm:text-sm font-bold text-[#f7e0ff]">
              {trimmed.substring(4)}
            </h4>
          );
        }
        if (trimmed.startsWith('## ')) {
          return (
            <h3 key={idx} className="mt-3.5 text-sm sm:text-base font-bold text-white">
              {trimmed.substring(3)}
            </h3>
          );
        }
        if (trimmed.startsWith('# ')) {
          return (
            <h2 key={idx} className="mt-4 text-base sm:text-lg font-black text-white">
              {trimmed.substring(2)}
            </h2>
          );
        }

        // Bullet Lists
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          return (
            <div key={idx} className="ml-3 flex items-start gap-2 text-xs sm:text-sm">
              <span className="text-[#e0a0fa]">•</span>
              <span>{formatInlineMarkdown(trimmed.substring(2))}</span>
            </div>
          );
        }

        // Numbered Lists
        const numMatch = trimmed.match(/^(\d+)\.\s+(.*)/);
        if (numMatch) {
          return (
            <div key={idx} className="ml-3 flex items-start gap-2 text-xs sm:text-sm">
              <span className="font-semibold text-[#e0a0fa]">{numMatch[1]}.</span>
              <span>{formatInlineMarkdown(numMatch[2])}</span>
            </div>
          );
        }

        // Quotes
        if (trimmed.startsWith('> ')) {
          return (
            <blockquote
              key={idx}
              className="my-1 border-l-2 border-[#b45ae5] pl-3 italic text-[#d4c1da]"
            >
              {formatInlineMarkdown(trimmed.substring(2))}
            </blockquote>
          );
        }

        if (!trimmed) {
          return <div key={idx} className="h-1" />;
        }

        return (
          <p key={idx} className="text-xs sm:text-sm">
            {formatInlineMarkdown(line)}
          </p>
        );
      })}
    </div>
  );
}

/**
 * Format inline elements like **bold** and `code`
 */
function formatInlineMarkdown(text: string): React.ReactNode {
  // Simple regex parser for `code` and **bold**
  const tokens: React.ReactNode[] = [];
  const regex = /(\*\*.*?\*\*|`.*?`)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const before = text.substring(lastIndex, match.index);
    if (before) tokens.push(before);

    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      tokens.push(
        <strong key={match.index} className="font-semibold text-white">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      tokens.push(
        <code
          key={match.index}
          className="rounded bg-[#2f1b39] px-1.5 py-0.5 font-mono text-[11px] text-[#f1c3ff]"
        >
          {token.slice(1, -1)}
        </code>
      );
    }
    lastIndex = match.index + token.length;
  }

  const after = text.substring(lastIndex);
  if (after) tokens.push(after);

  return <>{tokens}</>;
}

/**
 * Code Block Component with copy button and optional SVG live preview
 */
function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const [showSvgPreview, setShowSvgPreview] = useState(false);

  const isSvg =
    (language === 'xml' || language === 'svg' || language === 'html') &&
    code.includes('<svg') &&
    code.includes('</svg>');

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-2.5 overflow-hidden rounded-xl border border-[#48334e] bg-[#0c0810] shadow-md">
      {/* Code Header */}
      <div className="flex items-center justify-between border-b border-[#2a1d2e] bg-[#160e1b] px-3 py-1.5 text-xs text-[#baa5bf]">
        <div className="flex items-center gap-2">
          <Terminal className="h-3.5 w-3.5 text-[#e0a0fa]" />
          <span className="font-mono text-[11px] text-[#dab8eb] uppercase">{language || 'code'}</span>
        </div>

        <div className="flex items-center gap-2">
          {isSvg && (
            <button
              onClick={() => setShowSvgPreview(!showSvgPreview)}
              className="flex items-center gap-1 rounded bg-[#291732] px-2 py-0.5 text-[10px] text-[#e0a0fa] transition hover:bg-[#381f44]"
            >
              <Eye className="h-3 w-3" />
              <span>{showSvgPreview ? 'Show Code' : 'Visual Preview'}</span>
            </button>
          )}

          <button
            onClick={handleCopy}
            className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] transition hover:bg-[#281831] hover:text-white"
          >
            {copied ? (
              <>
                <Check className="h-3 w-3 text-emerald-400" />
                <span className="text-emerald-400">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                <span>Copy Code</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Live SVG Preview if toggled */}
      {isSvg && showSvgPreview ? (
        <div
          className="flex min-h-[160px] items-center justify-center p-4 bg-[#140c18]"
          dangerouslySetInnerHTML={{ __html: code }}
        />
      ) : (
        /* Preformatted Code Content */
        <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed text-[#eee1f3]">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}
