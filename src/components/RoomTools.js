'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const bucket = 'room-resources';

export default function RoomTools({ roomId, user }) {
  const [tab, setTab] = useState('chat');
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [ready, setReady] = useState(false);
  const [sending, setSending] = useState(false);
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const channelRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    let channel;

    async function connect() {
      try {
        await supabase.realtime.setAuth();
        if (cancelled) return;

        channel = supabase
          .channel(`room:${roomId}`, {
            config: {
              private: true,
              broadcast: { self: true, ack: true },
            },
          })
          .on('broadcast', { event: 'chat' }, ({ payload }) => {
            if (cancelled || typeof payload.text !== 'string') return;

            setMessages((previous) =>
              previous.some((message) => message.id === payload.id)
                ? previous
                : [...previous, payload].slice(-100)
            );
          })
          .subscribe((status) => {
            if (cancelled) return;
            setReady(status === 'SUBSCRIBED');

            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              setError('Chat connection failed. Check room membership and policies.');
            }
          });

        channelRef.current = channel;
      } catch {
        if (!cancelled) setError('Unable to connect to chat.');
      }
    }

    connect();

    return () => {
      cancelled = true;
      channelRef.current = null;
      if (channel) supabase.removeChannel(channel);
    };
  }, [roomId, user.id]);

  async function sendMessage(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !ready || sending) return;

    setSending(true);
    setError('');

    try {
      const result = await channelRef.current.send({
        type: 'broadcast',
        event: 'chat',
        payload: {
          id: crypto.randomUUID(),
          text,
          sender: user.user_metadata?.full_name || 'Student',
        },
      });

      if (result !== 'ok') throw new Error('Message was not delivered.');
      setDraft('');
    } catch {
      setError('Message failed to send. Please try again.');
    } finally {
      setSending(false);
    }
  }

  async function loadFiles() {
    setError('');

    const { data, error } = await supabase.storage
      .from(bucket)
      .list(String(roomId), {
        limit: 100,
        sortBy: { column: 'created_at', order: 'desc' },
      });

    if (error) setError(error.message);
    else setFiles((data || []).filter((file) => file.id));
  }

  useEffect(() => {
    if (tab === 'vault') loadFiles();
  }, [tab, roomId]);

  async function uploadFile(event) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;

    setUploading(true);
    setError('');

    try {
      if (file.size > 10 * 1024 * 1024) {
        throw new Error('Choose a file smaller than 10 MB.');
      }

      const path = `${roomId}/${crypto.randomUUID()}_${file.name}`;
      const { error } = await supabase.storage
        .from(bucket)
        .upload(path, file);

      if (error) throw error;
      await loadFiles();
    } catch (error) {
      setError(error.message);
    } finally {
      setUploading(false);
      input.value = '';
    }
  }

  async function openFile(file) {
    const popup = window.open('about:blank', '_blank');

    if (!popup) {
      setError('Allow pop-ups to open the file.');
      return;
    }

    popup.opener = null;

    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(`${roomId}/${file.name}`, 60);

    if (error) {
      popup.close();
      setError(error.message);
    } else {
      popup.location.href = data.signedUrl;
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 border-t pt-4">
      <div className="flex gap-2 mb-3">
        <button
          onClick={() => setTab('chat')}
          className={`flex-1 py-2 rounded-lg ${
            tab === 'chat' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100'
          }`}
        >
          Room Chat
        </button>

        <button
          onClick={() => setTab('vault')}
          className={`flex-1 py-2 rounded-lg ${
            tab === 'vault' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100'
          }`}
        >
          Resource Vault
        </button>
      </div>

      {error && <p role="alert" className="text-red-600 text-sm mb-2">{error}</p>}

      {tab === 'chat' ? (
        <>
          <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50 rounded-lg p-3 space-y-3">
            {!messages.length && (
              <p className="text-sm text-gray-400">
                {ready ? 'No messages yet.' : 'Connecting…'}
              </p>
            )}

            {messages.map((message) => (
              <div key={message.id} className="bg-white rounded-lg p-2 border">
                <p className="text-xs font-semibold text-indigo-600">
                  {message.sender}
                </p>
                <p className="text-sm break-words">{message.text}</p>
              </div>
            ))}
          </div>

          <form onSubmit={sendMessage} className="flex gap-2 mt-3">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={2000}
              placeholder="Message room…"
              className="min-w-0 flex-1 border rounded-lg p-2 text-sm"
            />
            <button
              disabled={!ready || sending || !draft.trim()}
              className="bg-indigo-600 text-white px-3 rounded-lg disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto space-y-3">
          <input type="file" onChange={uploadFile} disabled={uploading} />
          {uploading && <p className="text-sm">Uploading…</p>}

          <button onClick={loadFiles} className="text-indigo-600 text-sm">
            Refresh files
          </button>

          {!files.length && <p className="text-sm text-gray-400">No files yet.</p>}

          {files.map((file) => (
            <button
              key={file.id}
              onClick={() => openFile(file)}
              className="block w-full border rounded-lg p-3 text-left text-sm break-all"
            >
              {file.name.replace(/^[0-9a-f-]{36}_/i, '')}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}