import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

// Component for code blocks with individual copy button
const CodeBlock = ({ children, language }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group my-4 rounded-lg overflow-hidden border border-[var(--color-border-main)]">
      <div className="flex justify-between items-center px-4 py-1.5 bg-[#0d1117] border-b border-[#2d3139]">
        <span className="text-[10px] font-bold text-gray-500 uppercase">{language || 'code'}</span>
        <button onClick={handleCopy} className="flex items-center gap-1.5 text-gray-400 hover:text-white transition-colors cursor-pointer">
          <span className="material-symbols-outlined text-[14px]">{copied ? 'check' : 'content_copy'}</span>
          <span className="text-[10px] font-bold">{copied ? 'Copied!' : 'Copy code'}</span>
        </button>
      </div>
      <SyntaxHighlighter style={vscDarkPlus} language={language} PreTag="div" className="!m-0 !bg-[#010409]">
        {String(children).replace(/\n$/, '')}
      </SyntaxHighlighter>
    </div>
  );
};

function App() {
  // --- STATE MANAGEMENT ---
  const [isDarkMode, setIsDarkMode] = useState(() => localStorage.getItem('ai_theme') === 'light' ? false : true);
  const [conversations, setConversations] = useState(() => JSON.parse(localStorage.getItem('ai_conversations') || '[]'));
  const [currentChatId, setCurrentChatId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false); // Mobile sidebar toggle
  
  // --- SAFETY LOCKS ---
  const [isLoading, setIsLoading] = useState(false);
  const [cooldown, setCooldown] = useState(false); // Cooldown to prevent spam
  const [errorStatus, setErrorStatus] = useState(null); // To show specific quota errors
  
  const [copiedIndex, setCopiedIndex] = useState(null);
  const messagesEndRef = useRef(null);

  // Sync theme
  useEffect(() => {
    localStorage.setItem('ai_theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  // Handle window resize for sidebar behavior
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768) {
        setIsSidebarOpen(false); // Reset mobile sidebar when returning to desktop
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Save conversations to localStorage when they change
  useEffect(() => {
    if (currentChatId && messages.length > 0) {
      setConversations(prev => {
        const updated = prev.map(chat => {
          if (chat.id === currentChatId) {
            return { 
              ...chat, 
              messages: messages,
              title: chat.title === 'New Chat' ? (messages[0]?.text.slice(0, 30) + '...') : chat.title
            };
          }
          return chat;
        });
        localStorage.setItem('ai_conversations', JSON.stringify(updated));
        return updated;
      });
    }
  }, [messages, currentChatId]);

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  useEffect(() => { scrollToBottom(); }, [messages, isLoading]);

  // --- ACTIONS ---
  const startNewChat = () => {
    const newChat = { id: Date.now().toString(), title: 'New Chat', messages: [], timestamp: new Date().toISOString() };
    setConversations(prev => [newChat, ...prev]);
    setCurrentChatId(newChat.id);
    setMessages([]);
    setErrorStatus(null);
    if (window.innerWidth < 768) setIsSidebarOpen(false); // Close sidebar on mobile after starting chat
  };

  const loadChat = (chat) => {
    setCurrentChatId(chat.id);
    setMessages(chat.messages);
    setErrorStatus(null);
    if (window.innerWidth < 768) setIsSidebarOpen(false); // Close sidebar on mobile after loading chat
  };

  const deleteChat = (e, chatId) => {
    e.stopPropagation();
    const updated = conversations.filter(c => c.id !== chatId);
    setConversations(updated);
    localStorage.setItem('ai_conversations', JSON.stringify(updated));
    if (currentChatId === chatId) { setMessages([]); setCurrentChatId(null); }
  };

  // --- MAIN API CALL ---
  const handleSend = async (e) => {
    if (e) e.preventDefault();
    if (!input.trim() || isLoading || cooldown) return;

    const userText = input.trim();
    setInput('');
    setErrorStatus(null);
    
    let activeId = currentChatId;
    if (!activeId) {
      const newChat = { id: Date.now().toString(), title: userText.slice(0, 30) + '...', messages: [], timestamp: new Date().toISOString() };
      setConversations(prev => [newChat, ...prev]);
      setCurrentChatId(newChat.id);
      activeId = newChat.id;
    }

    const updatedMessages = [...messages, { role: 'user', text: userText }];
    setMessages(updatedMessages);
    setIsLoading(true);

    try {
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: userText }] }],
            generationConfig: { maxOutputTokens: 2048, temperature: 0.7 }
          })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 429) throw new Error('QUOTA_EXCEEDED');
        throw new Error(data.error?.message || 'API Error');
      }

      if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
        const botResponse = data.candidates[0].content.parts[0].text;
        setMessages(prev => [...prev, { role: 'bot', text: botResponse }]);
        setCooldown(true);
        setTimeout(() => setCooldown(false), 3000);
      }
    } catch (error) {
      console.error('API Call Error:', error);
      if (error.message === 'QUOTA_EXCEEDED') {
        setErrorStatus('⚠️ API limit reached. Please wait 60 seconds.');
      } else {
        setErrorStatus(`⚠️ Error: ${error.message}`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const copyToClipboard = (text, index) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div className={`flex h-screen overflow-hidden transition-colors duration-300 ${isDarkMode ? '' : 'light-mode'}`} style={{ backgroundColor: 'var(--color-main-bg)', color: 'var(--color-text-main)' }}>
      
      {/* MOBILE OVERLAY */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 md:hidden backdrop-blur-sm transition-opacity" 
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* SIDEBAR */}
      <aside 
        className={`fixed md:relative md:flex w-72 md:w-64 flex-col border-r border-[var(--color-border-main)] z-50 h-full transition-transform duration-300 ease-in-out ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`} 
        style={{ backgroundColor: 'var(--color-sidebar-bg)' }}
      >
        <div className="p-6 flex justify-between items-center">
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2" style={{ color: 'var(--color-text-main)' }}>
            <span className="material-symbols-outlined text-blue-500">smart_toy</span>
            Simple AI Chat
          </h1>
          <button onClick={() => setIsSidebarOpen(false)} className="md:hidden p-2 text-gray-500 hover:text-white transition-all cursor-pointer">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="px-4 mb-4">
          <button onClick={startNewChat} className="w-full flex items-center gap-3 px-4 py-3 bg-[var(--color-bubble-bot)] hover:brightness-110 transition-all rounded-xl text-sm font-medium border border-[var(--color-border-main)] cursor-pointer">
            <span className="material-symbols-outlined text-sm">add</span> New Chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto hide-scrollbar px-4 space-y-1">
          <div className="text-[11px] font-bold text-gray-500 uppercase tracking-widest px-2 mb-3 mt-4">History</div>
          {conversations.length === 0 ? (
            <p className="px-3 text-xs text-gray-600 italic">No previous chats</p>
          ) : (
            conversations.map((chat) => (
              <div key={chat.id} onClick={() => loadChat(chat)} className={`group flex items-center justify-between px-3 py-2.5 text-sm rounded-lg cursor-pointer transition-all ${currentChatId === chat.id ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20' : 'text-gray-500 hover:text-blue-500 hover:bg-gray-500/5'}`}>
                <span className="truncate flex-1 pr-2">{chat.title}</span>
                <button onClick={(e) => deleteChat(e, chat.id)} className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-500 transition-all cursor-pointer">
                  <span className="material-symbols-outlined text-[16px]">delete</span>
                </button>
              </div>
            ))
          )}
        </div>

        <div className="p-4 mt-auto border-t border-[var(--color-border-main)]">
          <button onClick={() => setIsDarkMode(!isDarkMode)} className="w-full flex items-center justify-between px-4 py-2 mb-4 rounded-xl border border-[var(--color-border-main)] hover:bg-gray-500/10 transition-all cursor-pointer">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-[20px]">{isDarkMode ? 'dark_mode' : 'light_mode'}</span>
              <span className="text-sm font-medium">{isDarkMode ? 'Dark' : 'Light'}</span>
            </div>
            <div className={`w-8 h-4 rounded-full relative transition-colors ${isDarkMode ? 'bg-blue-600' : 'bg-gray-300'}`}>
              <div className={`absolute top-1 w-2 h-2 rounded-full bg-white transition-all ${isDarkMode ? 'right-1' : 'left-1'}`} />
            </div>
          </button>
          <div className="flex items-center gap-3 px-2">
            <div className="w-9 h-9 rounded-full bg-[var(--color-bubble-bot)] flex items-center justify-center text-blue-500 font-bold border border-[var(--color-border-main)]">US</div>
            <div className="flex-1 overflow-hidden">
              <p className="text-sm font-bold truncate">User Account</p>
              <p className="text-[10px] text-gray-500">user@example.com</p>
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="flex-1 flex flex-col relative w-full h-full" style={{ backgroundColor: 'var(--color-main-bg)' }}>
        <header className="h-16 flex items-center justify-between px-4 md:px-8 border-b border-[var(--color-border-main)] bg-[var(--color-main-bg)]/80 backdrop-blur-md sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <button onClick={() => setIsSidebarOpen(true)} className="md:hidden p-2 -ml-2 text-gray-500 hover:bg-gray-500/10 rounded-lg cursor-pointer transition-all">
              <span className="material-symbols-outlined">menu</span>
            </button>
            <div className="flex flex-col md:flex-row md:items-center gap-0 md:gap-4 overflow-hidden">
              <h2 className="text-sm font-bold truncate max-w-[180px] md:max-w-[300px]">
                {conversations.find(c => c.id === currentChatId)?.title || 'New Conversation'}
              </h2>
              <span className="text-[9px] md:text-[10px] bg-blue-500/10 text-blue-500 px-1.5 md:px-2 py-0.5 rounded font-bold border border-blue-500/20 w-fit">Gemini 2.5</span>
            </div>
          </div>
          <button className="p-2 text-gray-400 hover:text-blue-500 transition-all cursor-pointer">
            <span className="material-symbols-outlined">share</span>
          </button>
        </header>

        {/* CHAT AREA */}
        <div className="flex-1 overflow-y-auto px-4 py-6 md:py-8 hide-scrollbar">
          <div className="max-w-3xl mx-auto space-y-6">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-[60vh] text-center opacity-40 px-6">
                <span className="material-symbols-outlined text-5xl md:text-6xl mb-4 text-blue-500">forum</span>
                <h3 className="text-lg md:text-xl font-bold mb-2">How can I help you today?</h3>
                <p className="text-xs max-w-[280px]">Start a conversation by typing your message below.</p>
              </div>
            ) : (
              messages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
                  <div className={`relative max-w-[90%] md:max-w-[85%] group rounded-2xl px-4 py-3 md:px-5 md:py-4 shadow-sm ${msg.role === 'user' ? 'bg-blue-600 text-white rounded-tr-none' : 'rounded-tl-none border border-[var(--color-border-main)]'}`} style={msg.role === 'bot' ? { backgroundColor: 'var(--color-bubble-bot)', color: 'var(--color-text-main)' } : {}}>
                    {msg.role === 'bot' && (
                      <button onClick={() => copyToClipboard(msg.text, idx)} className="absolute top-2 right-2 p-1.5 bg-gray-500/10 hover:bg-gray-500/20 rounded-md md:opacity-0 group-hover:opacity-100 transition-all cursor-pointer">
                        <span className="material-symbols-outlined text-[14px] md:text-[12px]">{copiedIndex === idx ? 'check' : 'content_copy'}</span>
                      </button>
                    )}
                    <div className="prose prose-sm md:prose-base max-w-none break-words" style={{ color: 'inherit' }}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code({node, inline, className, children, ...props}) { const match = /language-(\w+)/.exec(className || ''); return !inline && match ? ( <CodeBlock language={match[1]}>{String(children)}</CodeBlock> ) : ( <code className={`${className} bg-gray-500/10 px-1.5 py-0.5 rounded text-[0.85em] font-mono`} {...props}>{children}</code> ); } }}>
                        {msg.text}
                      </ReactMarkdown>
                    </div>
                  </div>
                </div>
              ))
            )}
            {isLoading && (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-tl-none px-5 py-4 border border-[var(--color-border-main)] flex items-center gap-3" style={{ backgroundColor: 'var(--color-bubble-bot)' }}>
                  <div className="flex gap-1.5">
                    <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce"></div>
                    <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:0.2s]"></div>
                    <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:0.4s]"></div>
                  </div>
                  <span className="text-xs font-medium text-gray-500">Thinking...</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} className="h-32 md:h-48" />
          </div>
        </div>

        {/* INPUT AREA */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t pt-10 pb-4 md:pb-6 px-4" style={{ backgroundImage: `linear-gradient(to top, var(--color-main-bg) 0%, var(--color-main-bg) 70%, transparent 100%)` }}>
          <div className="max-w-3xl mx-auto">
            {errorStatus && (
              <div className="mb-3 p-2.5 bg-red-500/10 border border-red-500/20 rounded-xl text-center">
                <p className="text-[10px] md:text-xs font-bold text-red-500">{errorStatus}</p>
              </div>
            )}
            
            <div className={`relative border transition-all p-1.5 md:p-2 pr-3 rounded-[26px] shadow-2xl ${isLoading || cooldown ? 'opacity-50 grayscale pointer-events-none' : 'focus-within:border-blue-500'}`} style={{ backgroundColor: 'var(--color-bubble-bot)', borderColor: 'var(--color-border-main)' }}>
              <div className="flex items-end gap-1">
                <button type="button" className="p-2 md:p-3 text-gray-400 hover:text-blue-500 cursor-pointer shrink-0"><span className="material-symbols-outlined text-[20px] md:text-[24px]">add</span></button>
                <textarea 
                  className="flex-1 bg-transparent border-none focus:ring-0 resize-none py-2.5 md:py-3 px-1 text-[14px] md:text-[15px] leading-[1.5] outline-none max-h-[120px] md:max-h-[150px] hide-scrollbar overflow-y-auto" 
                  placeholder={cooldown ? "Please wait..." : "Message AI Chat..."}
                  rows={1}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={isLoading || cooldown}
                  onInput={(e) => { const target = e.target; target.style.height = '40px'; target.style.height = `${Math.min(target.scrollHeight, 120)}px`; }}
                  style={{ height: '40px', color: 'var(--color-text-main)' }}
                />
                <div className="flex items-center gap-1 mb-1 md:mb-1.5 shrink-0">
                  <button type="button" className="hidden sm:block p-2 text-gray-400 hover:text-blue-500 cursor-pointer"><span className="material-symbols-outlined text-[20px]">mic</span></button>
                  <button 
                    onClick={handleSend}
                    disabled={!input.trim() || isLoading || cooldown}
                    className={`w-7 h-7 md:w-8 md:h-8 flex items-center justify-center rounded-full transition-all cursor-pointer ${input.trim() && !isLoading && !cooldown ? (isDarkMode ? 'bg-white text-black' : 'bg-blue-600 text-white') : 'bg-gray-500/20 text-gray-500'}`}
                  >
                    <span className="material-symbols-outlined text-[18px] md:text-[20px] font-bold">{isLoading ? 'hourglass_top' : 'arrow_upward'}</span>
                  </button>
                </div>
              </div>
            </div>
            <p className="text-[9px] md:text-[11px] text-center text-gray-500 mt-2.5 font-medium px-4">
              {cooldown ? "Wait 3s between messages." : "Simple AI Chat can make mistakes. Verify important info."}
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
