'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import RoomTools from '../components/RoomTools';

export default function SyncStudy({ initialUser }) {
  const [user, setUser] = useState(initialUser);
  const [authError, setAuthError] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [joinedRooms, setJoinedRooms] = useState({});
  const [activeRoom, setActiveRoom] = useState(null);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [createRoomError, setCreateRoomError] = useState('');
  const createRoomPending = useRef(false);
  
  // Screen Share State
  const [localScreenStream, setLocalScreenStream] = useState(null);
  const videoRef = useRef(null);

  const loadMyMemberships = async () => {
    if (!user) return;

    const { data, error } = await supabase
      .from('room_members')
      .select('room_id')
      .eq('user_id', user.id);

    if (error) {
      console.error(error.message);
      return;
    }

    setJoinedRooms(
      Object.fromEntries(data.map(({ room_id }) => [room_id, true]))
    );
  };

  useEffect(() => {
    if (user) loadMyMemberships();
  }, [user?.id]);

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
            setRooms((prev) =>
            prev.some((room) => room.id === payload.new.id)
              ? prev
              : [payload.new, ...prev]
          );
          } else if (payload.eventType === 'UPDATE') {
            loadMyMemberships();
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

  const handleCreateRoom = async (event) => {
    event.preventDefault();

    if (!user || createRoomPending.current) return;

    const form = event.currentTarget;
    const values = new FormData(form);

    const room = {
      title: String(values.get('title') || '').trim(),
      subject: String(values.get('subject') || '').trim(),
      location: String(values.get('location') || '').trim(),
      description: String(values.get('description') || '').trim(),
      created_by: user.id,
      student_count: 0,
    };

    if (!room.title || !room.subject || !room.location) {
      setCreateRoomError('Enter a title, subject and location.');
      return;
    }

    createRoomPending.current = true;
    setCreatingRoom(true);
    setCreateRoomError('');

    try {
      const { data, error } = await supabase
        .from('study_rooms')
        .insert(room)
        .select()
        .single();

      if (error) throw error;

      setRooms((previous) =>
        previous.some((existing) => existing.id === data.id)
          ? previous
          : [data, ...previous]
      );

      form.reset();
    } catch (error) {
      setCreateRoomError(error.message || 'Could not create the room.');
    } finally {
      createRoomPending.current = false;
      setCreatingRoom(false);
    }
  };

  // 3. Application Logic
  const handleLogin = async () => {
    setAuthError(null);
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    window.location.replace('/login');
  };

  const toggleRoomAttendance = async (roomId, currentCount, e) => {
    e.stopPropagation();
    if (!user) return;

    const isJoined = Boolean(joinedRooms[roomId]);

    const { error } = isJoined
      ? await supabase
          .from('room_members')
          .delete()
          .eq('room_id', roomId)
          .eq('user_id', user.id)
      : await supabase
          .from('room_members')
          .upsert(
            { room_id: roomId, user_id: user.id },
            {
              onConflict: 'room_id,user_id',
              ignoreDuplicates: true,
            }
          );

    if (error) {
      alert(error.message);
      return;
    }

    await loadMyMemberships();

    // Read the confirmed count instead of calculating it in the browser.
    const { data: updatedRoom } = await supabase
      .from('study_rooms')
      .select('*')
      .eq('id', roomId)
      .single();

    if (updatedRoom) {
      setRooms((prev) =>
        prev.map((room) => room.id === roomId ? updatedRoom : room)
      );
    }

    if (isJoined && activeRoom?.id === roomId) {
      setActiveRoom(null);
      if (localScreenStream) await toggleScreenShare(activeRoom);
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
          <form
            onSubmit={handleCreateRoom}
            className="mb-6 bg-white border border-gray-200 rounded-xl p-5 shadow-sm"
          >
            <h3 className="text-lg font-semibold mb-4">
              Create a study room
            </h3>

            <fieldset disabled={creatingRoom} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  ['title', 'Room title', 'e.g. Full Stack Revision'],
                  ['subject', 'Subject', 'e.g. Full Stack'],
                  ['location', 'Location', 'e.g. Seminar Hall'],
                ].map(([name, label, placeholder]) => (
                  <label key={name} className="block text-sm font-medium text-gray-700">
                    {label}
                    <input
                      name={name}
                      placeholder={placeholder}
                      required
                      maxLength={100}
                      className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </label>
                ))}
              </div>

              <label className="block text-sm font-medium text-gray-700">
                Description — optional
                <textarea
                  name="description"
                  rows={2}
                  maxLength={1000}
                  placeholder="What will you study?"
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </label>

              {createRoomError && (
                <p role="alert" className="text-sm text-red-600">
                  {createRoomError}
                </p>
              )}

              <button
                type="submit"
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-5 py-2 rounded-lg disabled:opacity-50"
              >
                {creatingRoom ? 'Creating…' : 'Create room'}
              </button>
            </fieldset>
          </form>
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

            <RoomTools
              key={activeRoom.id}
              roomId={activeRoom.id}
              user={user}
            />
          </div>
        )}
      </main>
    </div>
  );
}