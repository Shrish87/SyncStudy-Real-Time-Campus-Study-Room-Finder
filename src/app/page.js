'use client';

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase Client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default function SyncStudy() {
  const [user, setUser] = useState(null);
  const [authError, setAuthError] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [joinedRooms, setJoinedRooms] = useState({});
  const [activeRoom, setActiveRoom] = useState(null);
  
  // Screen Share State
  const [localScreenStream, setLocalScreenStream] = useState(null);
  const videoRef = useRef(null);

  // 1. Handle Auth & URL Errors on Mount
  useEffect(() => {
    // Check for domain rejection errors in the URL
    if (typeof window !== 'undefined') {
      const hashParams = new URLSearchParams(window.location.hash.substring(1));
      if (hashParams.get('error_description')) {
        setAuthError(decodeURIComponent(hashParams.get('error_description').replace(/\+/g, ' ')));
        // Clean URL
        window.history.replaceState(null, '', window.location.pathname);
      }
    }

    // Get current session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // 2. Fetch Rooms & Subscribe to Realtime Updates
  useEffect(() => {
    if (!user) return;

    const fetchRooms = async () => {
      const { data } = await supabase
        .from('study_rooms')
        .select('*')
        .order('created_at', { ascending: false });
      if (data) setRooms(data);
    };

    fetchRooms();

    // Supabase Realtime Subscription
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
              prev.map((room) => (room.id === payload.new.id ? payload.new : room))
            );
            // Update active room if it's currently open
            setActiveRoom((prev) => (prev?.id === payload.new.id ? payload.new : prev));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  // Attach video stream to ref when it becomes available
  useEffect(() => {
    if (videoRef.current && localScreenStream) {
      videoRef.current.srcObject = localScreenStream;
    }
  }, [localScreenStream]);

  // 3. Application Logic
  const handleLogin = async () => {
    setAuthError(null);
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/`,
      },
    });
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  const toggleRoomAttendance = async (roomId, currentCount, e) => {
    e.stopPropagation(); // Prevent opening the room modal when just joining
    const isJoined = joinedRooms[roomId];
    const newCount = isJoined ? Math.max(0, currentCount - 1) : currentCount + 1;

    // Close sidebar and stop screen share if leaving the currently active room
    if (isJoined && activeRoom?.id === roomId) {
      setActiveRoom(null);
      if (localScreenStream) {
        localScreenStream.getTracks().forEach(track => track.stop());
        setLocalScreenStream(null);
        // Clean up database share array
        const updatedSharers = (activeRoom.active_screen_sharers || []).filter(id => id !== user.id);
        supabase.from('study_rooms').update({ active_screen_sharers: updatedSharers }).eq('id', roomId);
      }
    }

    // Optimistic UI Update
    setRooms((prev) => prev.map((r) => (r.id === roomId ? { ...r, student_count: newCount } : r)));
    setJoinedRooms((prev) => ({ ...prev, [roomId]: !isJoined }));

    // Database Update
    const { error } = await supabase
      .from('study_rooms')
      .update({ student_count: newCount })
      .eq('id', roomId);

    // Rollback on failure
    if (error) {
      setRooms((prev) => prev.map((r) => (r.id === roomId ? { ...r, student_count: currentCount } : r)));
      setJoinedRooms((prev) => ({ ...prev, [roomId]: isJoined }));
    }
  };

  const toggleScreenShare = async (room) => {
    // If already sharing, stop the stream
    if (localScreenStream) {
      localScreenStream.getTracks().forEach((track) => track.stop());
      setLocalScreenStream(null);
      
      const updatedSharers = (room.active_screen_sharers || []).filter((id) => id !== user.id);
      await supabase.from('study_rooms').update({ active_screen_sharers: updatedSharers }).eq('id', room.id);
      return;
    }

    // Enforce 2-person maximum limit
    if (room.active_screen_sharers && room.active_screen_sharers.length >= 2) {
      alert("Maximum of 2 users can share their screen at a time in this room.");
      return;
    }

    try {
      // Trigger browser screen capture
      const stream = await navigator.mediaDevices.getDisplayMedia({ 
        video: { cursor: "always" }, 
        audio: false 
      });
      
      setLocalScreenStream(stream);

      // Add user to active sharers in DB
      const updatedSharers = [...(room.active_screen_sharers || []), user.id];
      await supabase.from('study_rooms').update({ active_screen_sharers: updatedSharers }).eq('id', room.id);

      // Handle native browser "Stop Sharing" button click
      stream.getVideoTracks()[0].onended = async () => {
        setLocalScreenStream(null);
        // Fetch freshest data to prevent race conditions during cleanup
        const { data: currentRoom } = await supabase
          .from('study_rooms')
          .select('active_screen_sharers')
          .eq('id', room.id)
          .single();
          
        const newSharers = (currentRoom?.active_screen_sharers || []).filter((id) => id !== user.id);
        await supabase.from('study_rooms').update({ active_screen_sharers: newSharers }).eq('id', room.id);
      };
    } catch (error) {
      console.error("Screen sharing cancelled or failed:", error);
    }
  };

  // 4. Render Auth View
  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 text-center">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">SyncStudy</h1>
          <p className="text-gray-500 mb-8">SSN College Engineering Workspace</p>
          
          {authError && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
              {authError}
            </div>
          )}

          <button
            onClick={handleLogin}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
          >
            Continue with Google (@ssn.edu.in)
          </button>
        </div>
      </div>
    );
  }

  // 5. Render Main Dashboard
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {/* Header */}
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-indigo-600">SyncStudy</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium text-gray-600">
              {user.user_metadata.full_name || user.email}
            </span>
            <button 
              onClick={handleLogout}
              className="text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-md px-3 py-1"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 py-8 flex gap-6">
        
        {/* Room Grid */}
        <div className="flex-1">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold">Active Study Rooms</h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {rooms.map((room) => (
              <div 
                key={room.id} 
                onClick={() => {
                  if (joinedRooms[room.id]) {
                    setActiveRoom(room);
                  } else {
                    alert("Please join the room before entering.");
                  }
                }}
                className={`bg-white p-5 rounded-xl border shadow-sm cursor-pointer transition hover:shadow-md ${
                  activeRoom?.id === room.id ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-gray-200'
                } ${!joinedRooms[room.id] && 'opacity-75 hover:opacity-100'}`}
              >
                <div className="flex justify-between items-start mb-2">
                  <span className="text-xs font-bold text-indigo-600 uppercase tracking-wider bg-indigo-50 px-2 py-1 rounded">
                    {room.subject}
                  </span>
                  <div className="flex items-center text-gray-500 text-sm">
                    <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
                    {room.student_count}
                  </div>
                </div>
                <h3 className="text-lg font-bold mb-1">{room.title}</h3>
                <p className="text-gray-500 text-sm mb-4">📍 {room.location}</p>
                
                <button
                  onClick={(e) => toggleRoomAttendance(room.id, room.student_count, e)}
                  className={`w-full py-2 rounded-lg text-sm font-semibold transition-colors ${
                    joinedRooms[room.id] 
                      ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' 
                      : 'bg-indigo-600 text-white hover:bg-indigo-700'
                  }`}
                >
                  {joinedRooms[room.id] ? 'Leave Room' : 'Join Room'}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Active Room Sidebar */}
        {activeRoom && (
          <div className="w-96 bg-white border-l border-gray-200 shadow-xl fixed right-0 top-0 h-screen overflow-hidden p-6 flex flex-col z-20">
            
            {/* Sidebar Header */}
            <div className="flex justify-between items-center mb-6 shrink-0">
              <h2 className="text-xl font-bold truncate pr-4">{activeRoom.title}</h2>
              <button 
                onClick={() => {
                  setActiveRoom(null);
                  if (localScreenStream) toggleScreenShare(activeRoom); // Cleanup stream on close
                }}
                className="text-gray-400 hover:text-gray-600 p-1 bg-gray-50 rounded"
              >
                ✕
              </button>
            </div>

            {/* Screen Sharing Section */}
            <div className="bg-gray-50 p-4 rounded-lg mb-6 border border-gray-100 shrink-0">
              <h4 className="text-sm font-semibold text-gray-500 mb-3 uppercase tracking-wide">Collaboration Tools</h4>
              
              <button 
                onClick={() => toggleScreenShare(activeRoom)}
                className={`w-full py-2.5 text-sm font-bold rounded-lg transition flex items-center justify-center ${
                  localScreenStream 
                    ? "bg-red-100 text-red-600 hover:bg-red-200 border border-red-200" 
                    : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"
                }`}
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                {localScreenStream ? "Stop Presenting" : "Present Screen"}
              </button>
            </div>

            {/* Video Feed Grid */}
            <div className="flex flex-col gap-4 mb-4 shrink-0">
              {localScreenStream && (
                <div className="relative bg-black rounded-lg overflow-hidden border border-gray-200 shadow-sm aspect-video">
                  <video
                    autoPlay
                    playsInline
                    muted // Prevent local echo
                    ref={videoRef}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute bottom-2 left-2 bg-black/60 px-2 py-1 rounded text-white text-xs font-medium backdrop-blur-sm shadow-sm">
                    You (Presenting)
                  </div>
                </div>
              )}

              {/* Remote Streams Placeholder */}
              {activeRoom.active_screen_sharers?.filter(id => id !== user?.id).map((remoteId) => (
                <div key={remoteId} className="relative bg-gray-900 rounded-lg overflow-hidden border border-gray-200 shadow-sm aspect-video flex items-center justify-center">
                  <p className="text-gray-400 text-sm">Receiving peer stream...</p>
                  <div className="absolute bottom-2 left-2 bg-black/60 px-2 py-1 rounded text-white text-xs font-medium backdrop-blur-sm shadow-sm">
                    Peer Student
                  </div>
                </div>
              ))}
            </div>

            {/* Chat & File Vault Structure */}
            <div className="flex-1 flex flex-col min-h-0 border-t border-gray-200 pt-4">
              
              {/* Tab Navigation */}
              <div className="flex space-x-2 mb-4 shrink-0">
                <button className="flex-1 py-2 text-sm font-semibold bg-indigo-50 text-indigo-700 rounded-lg">
                  Room Chat
                </button>
                <button className="flex-1 py-2 text-sm font-semibold bg-white border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50">
                  Resource Vault
                </button>
              </div>

              {/* Chat Container Area */}
              <div className="flex-1 bg-gray-50 rounded-lg border border-gray-200 flex flex-col overflow-hidden">
                
                {/* Message Feed */}
                <div className="flex-1 p-3 overflow-y-auto space-y-3">
                  <div className="text-xs text-gray-400 text-center mt-2">Welcome to {activeRoom.title}</div>
                  {/* Your existing message mapping logic will render here */}
                </div>

                {/* Input Area */}
                <div className="p-3 bg-white border-t border-gray-200 shrink-0">
                  <form className="flex gap-2" onSubmit={(e) => e.preventDefault()}>
                    <input 
                      type="text" 
                      placeholder="Message room..." 
                      className="flex-1 text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    <button 
                      type="submit"
                      className="bg-indigo-600 text-white px-3 py-2 rounded-md text-sm font-semibold hover:bg-indigo-700"
                    >
                      Send
                    </button>
                  </form>
                </div>
              </div>
            </div>

          </div>
        )}
      </main>
    </div>
  );
}