'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient'; 
import { Users, MapPin, BookOpen, PlusCircle, Search, MessageSquare, Send, X, BarChart2, ChevronDown, LogOut, User, Settings, Paperclip, Download, FileText, Bell, Calendar as CalendarIcon, Trophy } from 'lucide-react';

export default function Home() {
  // Auth States
  const [user, setUser] = useState(null);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoginView, setIsLoginView] = useState(true);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);

  // Password Strength Logic
  const passwordStrength = (() => {
    if (!authPassword) return null;
    const hasLower = /[a-z]/.test(authPassword);
    const hasUpper = /[A-Z]/.test(authPassword);
    const hasNumber = /[0-9]/.test(authPassword);
    const hasSpecial = /[^A-Za-z0-9]/.test(authPassword);
    const complexityScore = (hasLower ? 1 : 0) + (hasUpper ? 1 : 0) + (hasNumber ? 1 : 0) + (hasSpecial ? 1 : 0);
    const len = authPassword.length;

    if (len >= 8 && complexityScore === 4) return { label: 'Strong', bars: 3, color: 'bg-green-500', text: 'text-green-500' };
    if (len >= 6 && complexityScore >= 2) return { label: 'Medium', bars: 2, color: 'bg-amber-500', text: 'text-amber-600' };
    return { label: 'Weak', bars: 1, color: 'bg-red-500', text: 'text-red-500' };
  })();

  // Room & Leaderboard States
  const [rooms, setRooms] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [formData, setFormData] = useState({ title: '', subject: '', location: '', description: '' });
  const [loading, setLoading] = useState(true);
  
  // Advanced Feature States
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSubject, setSelectedSubject] = useState('All');
  const [joinedRooms, setJoinedRooms] = useState({});
  
  // Chat & Vault States
  const [activeChatRoom, setActiveChatRoom] = useState(null);
  const [chatMessages, setChatMessages] = useState({});
  const [typedMessage, setTypedMessage] = useState('');
  const [drawerTab, setDrawerTab] = useState('chat'); // 'chat' or 'vault'
  const [roomFiles, setRoomFiles] = useState({});
  const [isUploading, setIsUploading] = useState(false);

  // Pomodoro Interval States
  const POMODORO_DURATION = 1500; // 25 minutes
  const [pomodoroTime, setPomodoroTime] = useState(POMODORO_DURATION);
  const [isTimerRunning, setIsTimerRunning] = useState(false);

  // Fetch Rooms & Leaderboard
  useEffect(() => {
    const fetchData = async () => {
      const { data: roomData } = await supabase.from('study_rooms').select('*').order('created_at', { ascending: false });
      if (roomData) setRooms(roomData);

      const { data: statsData } = await supabase.from('user_stats').select('*').order('total_focus_minutes', { ascending: false }).limit(5);
      if (statsData) setLeaderboard(statsData);

      setLoading(false);
    };
    fetchData();
  }, []);

  // Authentication Setup & Push Notification Permissions
  useEffect(() => {
    const checkUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setUser(session?.user || null);
    };
    checkUser();

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user || null);
    });

    if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
      Notification.requestPermission();
    }

    return () => authListener.subscription.unsubscribe();
  }, []);

  // Real-time Database & Chat Listeners
  useEffect(() => {
  const channel = supabase
    .channel('realtime-rooms')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'study_rooms' },
      (payload) => {
        if (payload.eventType === 'INSERT') {
          setRooms((prev) => [payload.new, ...prev]);
        } else if (payload.eventType === 'UPDATE') {
          setRooms((prev) =>
            prev.map((room) =>
              room.id === payload.new.id ? payload.new : room
            )
          );
        }
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}, []);

  // Fetch Vault Files
  useEffect(() => {
    if (activeChatRoom) fetchRoomFiles(activeChatRoom.id);
  }, [activeChatRoom]);

  const fetchRoomFiles = async (roomId) => {
    const { data } = await supabase.storage.from('room-resources').list(roomId);
    if (data) setRoomFiles(prev => ({ ...prev, [roomId]: data.filter(f => f.name !== '.emptyFolderPlaceholder') }));
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !activeChatRoom) return;
    
    setIsUploading(true);
    const filePath = `${activeChatRoom.id}/${Date.now()}_${file.name}`;
    
    const { error } = await supabase.storage.from('room-resources').upload(filePath, file);
    if (!error) {
      fetchRoomFiles(activeChatRoom.id);
      const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const senderName = user?.user_metadata?.full_name || 'A student';
      const fileMsg = `📎 Shared a new file: ${file.name}`;
      
      await supabase.channel('campus-chat').send({
        type: 'broadcast', event: 'message', payload: { roomId: activeChatRoom.id, message: fileMsg, timestamp, senderName }
      });
      setChatMessages(prev => ({
        ...prev, [activeChatRoom.id]: [...(prev[activeChatRoom.id] || []), { text: fileMsg, time: timestamp, sender: senderName, self: true }]
      }));
    } else alert("Upload failed: " + error.message);
    setIsUploading(false);
  };

  const getFileUrl = (roomId, fileName) => supabase.storage.from('room-resources').getPublicUrl(`${roomId}/${fileName}`).data.publicUrl;

  // Gamified Pomodoro Logic
  useEffect(() => {
    let interval = null;
    if (isTimerRunning && pomodoroTime > 0) {
      interval = setInterval(() => setPomodoroTime(prev => prev - 1), 1000);
    } else if (pomodoroTime === 0 && isTimerRunning) {
      setIsTimerRunning(false);
      handlePomodoroComplete();
    }
    return () => clearInterval(interval);
  }, [isTimerRunning, pomodoroTime]);

  const handlePomodoroComplete = async () => {
    if (Notification.permission === 'granted') new Notification('Focus interval complete! +25 mins earned.');
    
    // Log minutes to database
    if (user) {
      const { data: currentStats } = await supabase.from('user_stats').select('total_focus_minutes').eq('user_id', user.id).single();
      
      const newTotal = (currentStats?.total_focus_minutes || 0) + 25;
      
      await supabase.from('user_stats').upsert({
        user_id: user.id,
        full_name: user.user_metadata?.full_name || 'Student',
        total_focus_minutes: newTotal
      });
    }
    setPomodoroTime(POMODORO_DURATION);
  };

  const toggleTimer = () => setIsTimerRunning(!isTimerRunning);
  const formatTimer = (seconds) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;

// Google Calendar Integration
  const addToGoogleCalendar = (room) => {
    const now = new Date();
    // Default event duration to 1 hour from now
    const end = new Date(now.getTime() + 60 * 60 * 1000); 

    // Convert dates to Google Calendar's required format: YYYYMMDDTHHMMSSZ (UTC)
    const startDate = now.toISOString().replace(/-|:|\.\d+/g, '');
    const endDate = end.toISOString().replace(/-|:|\.\d+/g, '');

    const title = encodeURIComponent(`Study Session: ${room.title}`);
    const details = encodeURIComponent(`Subject: ${room.subject}\nHosted on SyncStudy.`);
    const location = encodeURIComponent(room.location);

    const googleCalendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&details=${details}&location=${location}&dates=${startDate}/${endDate}`;

    // Open the generated link in a new browser tab
    window.open(googleCalendarUrl, '_blank', 'noopener,noreferrer');
  };

  // User Actions
  const toggleRoomAttendance = async (roomId, currentCount) => {
    const isJoined = joinedRooms[roomId];
    const newCount = isJoined ? Math.max(0, currentCount - 1) : currentCount + 1;

    // 1. Optimistically update local React state for immediate UI feedback
    setRooms((prevRooms) =>
      prevRooms.map((room) =>
        room.id === roomId ? { ...room, student_count: newCount } : room
      )
    );
    setJoinedRooms((prev) => ({ ...prev, [roomId]: !isJoined }));

    // 2. Persist the change to Supabase
    const { error } = await supabase
      .from('study_rooms')
      .update({ student_count: newCount })
      .eq('id', roomId);

    // Rollback local state if database update fails
    if (error) {
      console.error('Failed to update student count:', error.message);
      setRooms((prevRooms) =>
        prevRooms.map((room) =>
          room.id === roomId ? { ...room, student_count: currentCount } : room
        )
      );
      setJoinedRooms((prev) => ({ ...prev, [roomId]: isJoined }));
    }
  };

  const sendLiveMessage = async (e) => {
    e.preventDefault();
    if (!typedMessage.trim() || !activeChatRoom) return;

    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const senderName = user?.user_metadata?.full_name || 'Student';
    
    await supabase.channel('campus-chat').send({
      type: 'broadcast', event: 'message', payload: { roomId: activeChatRoom.id, message: typedMessage, timestamp, senderName }
    });
    setChatMessages(prev => ({
      ...prev, [activeChatRoom.id]: [...(prev[activeChatRoom.id] || []), { text: typedMessage, time: timestamp, sender: senderName, self: true }]
    }));
    setTypedMessage('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const { error } = await supabase.from('study_rooms').insert([{ ...formData, host_id: user.id }]);
    if (!error) setFormData({ title: '', subject: '', location: '', description: '' });
  };

  // Auth Handlers
  const handleSignUp = async (e) => {
    e.preventDefault();
    if (authPassword !== confirmPassword) return alert("Passwords do not match.");
    const { error } = await supabase.auth.signUp({ email: authEmail, password: authPassword, options: { data: { full_name: authName } } });
    if (error) alert(error.message);
    else { alert('Sign up successful!'); setIsLoginView(true); setAuthPassword(''); setConfirmPassword(''); }
  };
  const handleSignIn = async (e) => {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
    if (error) alert(error.message);
  };
  const handleSignOut = async () => await supabase.auth.signOut();
  const handlePasswordReset = async (e) => {
    e.preventDefault();
    if (!authEmail) return alert('Please enter your college email first.');
    const { error } = await supabase.auth.resetPasswordForEmail(authEmail);
    if (error) alert(error.message); else alert('Password reset link sent!');
  };

  const handleGoogleLogin = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        // window.location.origin dynamically detects your environment 
        // (http://localhost:3000 now, and your actual domain later)
        redirectTo: window.location.origin, 
      },
    });
    if (error) alert(error.message);
  };

  // Render Auth Gate
  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 max-w-md w-full">
          <h2 className="text-2xl font-black text-blue-600 mb-6 text-center">⚡ SyncStudy {isLoginView ? 'Login' : 'Sign Up'}</h2>
          <form className="space-y-5">
            {!isLoginView && (
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1.5">Full Name</label>
                <input type="text" placeholder="e.g., Jane Doe" className="w-full p-3 border rounded-lg text-black bg-gray-50 outline-none focus:ring-2 focus:ring-blue-500" value={authName} onChange={(e) => setAuthName(e.target.value)} />
              </div>
            )}
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1.5">College Email</label>
              <input type="email" placeholder="student@ssn.edu.in" className="w-full p-3 border rounded-lg text-black bg-gray-50 outline-none focus:ring-2 focus:ring-blue-500" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1.5">Password</label>
              <input type="password" placeholder={isLoginView ? "Enter password" : "Create password"} className="w-full p-3 border rounded-lg text-black bg-gray-50 outline-none focus:ring-2 focus:ring-blue-500" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} />
              {!isLoginView && passwordStrength && (
                <div className="mt-2 flex items-center justify-between gap-3">
                  <div className="flex gap-1 flex-1">
                    <div className={`h-1.5 flex-1 rounded-full ${passwordStrength.bars >= 1 ? passwordStrength.color : 'bg-gray-200'}`}></div>
                    <div className={`h-1.5 flex-1 rounded-full ${passwordStrength.bars >= 2 ? passwordStrength.color : 'bg-gray-200'}`}></div>
                    <div className={`h-1.5 flex-1 rounded-full ${passwordStrength.bars === 3 ? passwordStrength.color : 'bg-gray-200'}`}></div>
                  </div>
                  <span className={`text-[10px] font-bold uppercase tracking-wider ${passwordStrength.text}`}>{passwordStrength.label}</span>
                </div>
              )}
              {isLoginView && <div className="text-center mt-3"><button type="button" onClick={handlePasswordReset} className="text-sm font-semibold text-blue-600 hover:underline">Forgot password?</button></div>}
            </div>
            {!isLoginView && (
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1.5">Confirm Password</label>
                <input type="password" placeholder="Re-enter password" className="w-full p-3 border rounded-lg text-black bg-gray-50 outline-none focus:ring-2 focus:ring-blue-500" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
              </div>
            )}
            <div className="pt-2"><button onClick={isLoginView ? handleSignIn : handleSignUp} className="w-full bg-blue-600 text-white p-3 rounded-lg text-sm font-bold shadow-sm">{isLoginView ? 'Sign In' : 'Create Account'}</button></div>
            {/* Google OAuth Separator & Button */}
            <div className="flex items-center gap-3 mt-4 mb-2">
              <div className="flex-1 h-px bg-gray-200"></div>
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Or</span>
              <div className="flex-1 h-px bg-gray-200"></div>
            </div>

            <button 
              type="button" 
              onClick={handleGoogleLogin} 
              className="w-full bg-white text-gray-700 border border-gray-200 p-3 rounded-lg text-sm font-bold shadow-sm hover:bg-gray-50 transition flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </button>
            <div className="text-center mt-4 border-t border-gray-100 pt-4"><button type="button" onClick={() => { setIsLoginView(!isLoginView); setAuthPassword(''); setConfirmPassword(''); }} className="text-sm text-gray-500 hover:text-gray-900">{isLoginView ? "Don't have an account? Sign up" : "Already have an account? Log in"}</button></div>
          </form>
        </div>
      </div>
    );
  }

  const filteredRooms = rooms.filter((room) => {
    const matchesSearch = room.title.toLowerCase().includes(searchTerm.toLowerCase()) || room.subject.toLowerCase().includes(searchTerm.toLowerCase()) || room.location.toLowerCase().includes(searchTerm.toLowerCase());
    return (selectedSubject === 'All' || room.subject.toLowerCase() === selectedSubject.toLowerCase()) && matchesSearch;
  });
  const uniqueSubjects = ['All', ...new Set(rooms.map((r) => r.subject))];

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans flex flex-col relative overflow-x-hidden">
      <header className="bg-white border-b sticky top-0 z-10 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-black text-blue-600 flex items-center gap-2">⚡ SyncStudy</h1>
            <span className="hidden md:flex text-xs font-semibold bg-green-100 text-green-700 px-3 py-1 rounded-full animate-pulse items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-500"></span> Live Syncing
            </span>
          </div>
          <div className="flex items-center gap-4">
            {/* Leaderboard Toggle Button */}
            <button 
              onClick={() => setShowLeaderboard(!showLeaderboard)} 
              className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-lg text-sm font-bold transition shadow-sm border border-amber-200"
            >
              <Trophy className="w-4 h-4" /> Top Scholars
            </button>
            <div className="relative">
              <button onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)} className="flex items-center gap-2 hover:bg-gray-50 p-1.5 pr-3 rounded-full border border-transparent transition-all">
                <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-sm shadow-sm">
                  {user.user_metadata?.full_name?.charAt(0).toUpperCase() || user.email.charAt(0).toUpperCase()}
                </div>
                <span className="text-sm font-semibold text-gray-700 max-w-[120px] truncate">{user.user_metadata?.full_name || 'Student'}</span>
                <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${isProfileMenuOpen ? 'rotate-180' : ''}`} />
              </button>
              {isProfileMenuOpen && (
                <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden z-50">
                  <div className="p-4 border-b bg-gray-50"><p className="font-bold text-sm truncate">{user.user_metadata?.full_name}</p><p className="text-xs text-gray-500 truncate mt-0.5">{user.email}</p></div>
                  <div className="p-2 border-t border-gray-50"><button onClick={handleSignOut} className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg text-left"><LogOut className="w-4 h-4" /> <span className="font-semibold">Sign Out</span></button></div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Leaderboard Modal */}
      {showLeaderboard && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="bg-amber-500 p-4 flex justify-between items-center text-white">
              <h3 className="font-black text-lg flex items-center gap-2"><Trophy className="w-5 h-5" /> Campus Focus Leaderboard</h3>
              <button onClick={() => setShowLeaderboard(false)} className="hover:bg-amber-600 p-1.5 rounded-full transition"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-2">
              {leaderboard.length > 0 ? (
                leaderboard.map((stat, index) => (
                  <div key={stat.user_id} className="flex items-center gap-4 p-3 hover:bg-gray-50 rounded-xl transition">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${index === 0 ? 'bg-yellow-100 text-yellow-700' : index === 1 ? 'bg-gray-100 text-gray-600' : index === 2 ? 'bg-orange-100 text-orange-700' : 'bg-blue-50 text-blue-600'}`}>
                      #{index + 1}
                    </div>
                    <div className="flex-1">
                      <p className="font-bold text-gray-900 text-sm">{stat.full_name}</p>
                      <p className="text-xs text-gray-500">{stat.user_id === user.id ? 'You' : 'Student'}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-black text-blue-600">{stat.total_focus_minutes}</p>
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Mins</p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="p-8 text-center text-gray-500 text-sm">No focus stats recorded yet.</p>
              )}
            </div>
          </div>
        </div>
      )}

      <main className="max-w-6xl mx-auto px-4 py-8 grid md:grid-cols-3 gap-8 flex-1 w-full">
        {/* Creation Form */}
        <div className="md:col-span-1">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 sticky top-24">
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-gray-800"><PlusCircle className="w-5 h-5 text-blue-500" /> Host Session</h3>
            <form onSubmit={handleSubmit} className="space-y-3">
              <input type="text" placeholder="Session Title" className="w-full p-2.5 border rounded-lg text-sm text-black bg-gray-50 outline-none focus:ring-2 focus:ring-blue-500" value={formData.title} onChange={(e) => setFormData({ ...formData, title: e.target.value })} required />
              <input type="text" placeholder="Subject" className="w-full p-2.5 border rounded-lg text-sm text-black bg-gray-50 outline-none focus:ring-2 focus:ring-blue-500" value={formData.subject} onChange={(e) => setFormData({ ...formData, subject: e.target.value })} required />
              <input type="text" placeholder="Location" className="w-full p-2.5 border rounded-lg text-sm text-black bg-gray-50 outline-none focus:ring-2 focus:ring-blue-500" value={formData.location} onChange={(e) => setFormData({ ...formData, location: e.target.value })} required />
              <textarea placeholder="Description..." rows={3} className="w-full p-2.5 border rounded-lg text-sm text-black bg-gray-50 outline-none focus:ring-2 focus:ring-blue-500" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} />
              <button type="submit" className="w-full bg-blue-600 text-white p-2.5 rounded-lg text-sm font-semibold hover:bg-blue-700 shadow-sm">Broadcast Live 🚀</button>
            </form>
          </div>
        </div>

        {/* Analytics & Grid */}
        <div className="md:col-span-2 space-y-6">
          <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-3.5" />
              <input type="text" placeholder="Search sessions..." className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm text-black outline-none bg-gray-50 focus:ring-2 focus:ring-blue-500" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              {uniqueSubjects.map((subject) => (
                <button key={subject} onClick={() => setSelectedSubject(subject)} className={`text-xs px-2.5 py-1 rounded-md transition capitalize ${selectedSubject === subject ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>{subject}</button>
              ))}
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            {filteredRooms.map((room) => (
              <div key={room.id} className="bg-white border rounded-2xl p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-start mb-3">
                    <span className="text-xs font-bold bg-blue-50 text-blue-600 px-2.5 py-1 rounded-md uppercase">{room.subject}</span>
                    <button onClick={() => setActiveChatRoom(room)} className="text-gray-400 hover:text-blue-600 p-1 relative">
                      <MessageSquare className="w-5 h-5" />
                      {chatMessages[room.id]?.length > 0 && <span className="absolute top-0 right-0 w-2 h-2 bg-red-500 rounded-full"></span>}
                    </button>
                  </div>
                  <h4 className="font-bold text-lg text-gray-900 mb-1">{room.title}</h4>
                  <p className="text-sm text-gray-500 flex items-center gap-1.5 mb-4"><MapPin className="w-4 h-4" /> {room.location}</p>
                </div>
                
                {/* Updated Action Area with Calendar Icon */}
                <div className="mt-4 pt-4 border-t border-gray-50 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-600 flex items-center gap-1.5"><Users className="w-4 h-4 text-gray-400" /> {room.student_count || 0}</span>
                    <button onClick={() => toggleRoomAttendance(room.id, room.student_count || 0)} className={`px-3.5 py-1.5 rounded-lg text-xs font-bold shadow-sm ${joinedRooms[room.id] ? 'bg-red-50 text-red-600' : 'bg-gray-900 text-white'}`}>
                      {joinedRooms[room.id] ? 'Leave' : 'Join'}
                    </button>
                  </div>
                  
                  {joinedRooms[room.id] && (
                    <button onClick={() => addToGoogleCalendar(room)} className="w-full flex justify-center items-center gap-2 text-xs font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 py-2 rounded-lg transition">
                      <CalendarIcon className="w-3.5 h-3.5" /> Add to Calendar
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>

      {/* Upgraded Chat & Vault Drawer */}
      {activeChatRoom && (
        <div className="fixed bottom-4 right-4 w-80 bg-white border border-gray-200 rounded-2xl shadow-2xl flex flex-col overflow-hidden z-50">
          <div className="bg-gray-900 p-3 flex justify-between items-center text-white">
            <h4 className="font-bold text-sm truncate pr-2 flex items-center gap-2"><MessageSquare className="w-4 h-4" /> {activeChatRoom.title}</h4>
            <button onClick={() => setActiveChatRoom(null)} className="p-1.5 rounded-full hover:bg-gray-700 text-gray-300 transition"><X className="w-4 h-4" /></button>
          </div>
          
          <div className="flex border-b border-gray-100 bg-gray-50 text-xs font-bold">
            <button onClick={() => setDrawerTab('chat')} className={`flex-1 py-2 text-center transition ${drawerTab === 'chat' ? 'text-blue-600 border-b-2 border-blue-600 bg-white' : 'text-gray-500'}`}>Live Chat</button>
            <button onClick={() => setDrawerTab('vault')} className={`flex-1 py-2 text-center transition ${drawerTab === 'vault' ? 'text-blue-600 border-b-2 border-blue-600 bg-white' : 'text-gray-500'}`}>Resource Vault</button>
          </div>

          <div className="bg-blue-50/50 p-2 border-b border-gray-100 flex justify-between items-center">
            <span className="text-xs font-bold text-gray-600">⏱️ Focus Clock: {formatTimer(pomodoroTime)}</span>
            <button onClick={toggleTimer} className={`text-[10px] font-bold px-2 py-1 rounded text-white shadow-sm ${isTimerRunning ? 'bg-amber-500' : 'bg-blue-600'}`}>{isTimerRunning ? 'Pause' : 'Start'}</button>
          </div>

          <div className="p-4 h-64 overflow-y-auto space-y-3 bg-gray-50 flex flex-col">
            {drawerTab === 'chat' ? (
              <>
                {chatMessages[activeChatRoom.id]?.map((msg, index) => (
                  <div key={index} className={`flex flex-col ${msg.self ? 'items-end' : 'items-start'}`}>
                    {!msg.self && <span className="text-[10px] text-gray-500 mb-0.5 ml-1">{msg.sender}</span>}
                    <div className={`p-2.5 rounded-xl text-xs max-w-[85%] shadow-sm ${msg.self ? 'bg-blue-600 text-white rounded-br-none' : 'bg-white text-gray-800 border rounded-bl-none'}`}>
                      {msg.text}
                    </div>
                    <span className="text-[10px] text-gray-400 mt-1">{msg.time}</span>
                  </div>
                ))}
                {(!chatMessages[activeChatRoom.id] || chatMessages[activeChatRoom.id].length === 0) && <p className="text-xs text-gray-400 text-center m-auto">No messages yet. Say hello!</p>}
              </>
            ) : (
              <div className="space-y-2">
                {roomFiles[activeChatRoom.id]?.length > 0 ? (
                  roomFiles[activeChatRoom.id].map((file) => (
                    <div key={file.name} className="bg-white p-2.5 rounded-lg border border-gray-100 flex items-center justify-between shadow-sm">
                      <div className="flex items-center gap-2 truncate">
                        <FileText className="w-4 h-4 text-blue-500 flex-shrink-0" />
                        <span className="text-xs font-medium text-gray-700 truncate">{file.name.split('_').slice(1).join('_') || file.name}</span>
                      </div>
                      <a href={getFileUrl(activeChatRoom.id, file.name)} target="_blank" rel="noopener noreferrer" className="p-1.5 bg-gray-50 hover:bg-blue-50 hover:text-blue-600 rounded-md text-gray-500 transition">
                        <Download className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-gray-400 text-center m-auto">No files shared yet.</p>
                )}
              </div>
            )}
          </div>

          <form onSubmit={sendLiveMessage} className="p-3 bg-white border-t border-gray-100 flex gap-2 items-center">
            {drawerTab === 'vault' ? (
              <label className="flex-1 flex justify-center items-center gap-2 bg-gray-100 text-gray-600 p-2 rounded-lg text-xs font-bold cursor-pointer hover:bg-gray-200 transition">
                {isUploading ? 'Uploading...' : <><Paperclip className="w-4 h-4" /> Select File</>}
                <input type="file" className="hidden" onChange={handleFileUpload} disabled={isUploading} />
              </label>
            ) : (
              <>
                <input type="text" placeholder="Send message..." className="flex-1 px-3 py-2 border rounded-lg text-xs text-black outline-none bg-gray-50 focus:ring-2 focus:ring-blue-500" value={typedMessage} onChange={(e) => setTypedMessage(e.target.value)} />
                <button type="submit" className="bg-blue-600 text-white p-2 rounded-lg hover:bg-blue-700 shadow-sm"><Send className="w-4 h-4" /></button>
              </>
            )}
          </form>
        </div>
      )}
    </div>
  );
}