'use client';

import React, { useCallback, useEffect, useState, useRef } from 'react';
import useWallet from '../hooks/useWallet';
import useWebSocket from '../hooks/useWebSocket';
import usePeerConnection from '../hooks/usePeerConection';

export default function HomePage() {
  const { walletAddress, connectWallet, isConnecting, error } = useWallet();
  const [roomId, setRoomId] = useState('');
  const [joined, setJoined] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [encryptionError, setEncryptionError] = useState<string | null>(null);
  const sendSocketMessageRef = useRef<(msg: any) => void>(() => {});
  const [peerRole, setPeerRole] = useState<'initiator' | 'responder' | null>(null);
  const [isProcessingOffer, setIsProcessingOffer] = useState(false);
  const [peerReady, setPeerReady] = useState(false);
  const [connectionAttempts, setConnectionAttempts] = useState(0);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const maxConnectionAttempts = 3;

  const peer = usePeerConnection({
    onMessage: useCallback((msg: string) => {
      setMessages((prev) => [...prev, "🔒 Peer: " + msg]);
    }, []),
    onConnectionStateChange: useCallback((state: RTCPeerConnectionState) => {
      console.log("[Mesh3] Peer connection state changed:", state);
      if (state === 'connected') {
        setMessages((prev) => [...prev, "🟢 Peer connection established!"]);
        setConnectionAttempts(0);
        setIsReconnecting(false);
      } else if (state === 'disconnected') {
        setMessages((prev) => [...prev, "🟡 Peer connection lost, attempting to reconnect..."]);
        setIsReconnecting(true);
      } else if (state === 'failed') {
        setMessages((prev) => [...prev, "🔴 Peer connection failed"]);
        setIsReconnecting(false);
        
        // Attempt to reconnect if we haven't exceeded max attempts
        if (connectionAttempts < maxConnectionAttempts) {
          setTimeout(() => {
            console.log(`[Mesh3] Attempting reconnection (${connectionAttempts + 1}/${maxConnectionAttempts})`);
            setConnectionAttempts(prev => prev + 1);
            handleReconnect();
          }, 2000);
        } else {
          setMessages((prev) => [...prev, "❌ Max reconnection attempts reached. Please rejoin the room."]);
        }
      }
    }, [connectionAttempts]),
    onEncryptionReady: useCallback(() => {
      setMessages((prev) => [...prev, "🔐 End-to-end encryption established! Messages are now secure."]);
      setEncryptionError(null);
    }, []),
    onEncryptionError: useCallback((error: string) => {
      setEncryptionError(error);
      setMessages((prev) => [...prev, `❌ Encryption Error: ${error}`]);
    }, []),
    onIceCandidate: useCallback((candidate: RTCIceCandidate) => {
      // Send ICE candidate to peer via signaling server
      sendSocketMessageRef.current({
        type: 'ice_candidate',
        room_id: roomId,
        candidate: candidate.toJSON()
      });
    }, [roomId])
  });

  const handleReconnect = useCallback(async () => {
    if (!roomId || !joined) return;
    
    console.log('[Mesh3] Initiating reconnection...');
    setIsReconnecting(true);
    
    try {
      // Reset peer connection
      peer.reset();
      
      // Brief delay to ensure cleanup
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Rejoin the room
      sendSocketMessageRef.current({ type: 'join_room', room_id: roomId });
      setMessages((prev) => [...prev, "🔄 Reconnecting to room..."]);
      
    } catch (error) {
      console.error('[Mesh3] Reconnection failed:', error);
      setMessages((prev) => [...prev, "❌ Reconnection failed"]);
      setIsReconnecting(false);
    }
  }, [roomId, joined, peer]);

  const handleSignalMessage = useCallback(async (msg: any) => {
    console.log('[Mesh3] Signal message received:', msg);
    console.log('[Mesh3] Current signaling state:', peer.peerRef?.current?.signalingState);

    try {
      switch (msg.type) {
        case 'room_joined':
          // Backend tells us our role based on join order
          const role = msg.peer_count === 1 ? 'initiator' : 'responder';
          setPeerRole(role);
          console.log(`[Mesh3] Assigned role: ${role} (peer count: ${msg.peer_count})`);
          
          if (role === 'initiator') {
            setMessages((prev) => [...prev, "📡 Waiting for second peer to join..."]);
          } else {
            setMessages((prev) => [...prev, "📡 Joining as responder, waiting for offer..."]);
          }
          break;

        case 'peer_ready':
          // Only initiator receives this when responder is ready
          console.log('[Mesh3] Received peer_ready signal');
          setPeerReady(true);
          setMessages((prev) => [...prev, "🤝 Second peer joined, initiating connection..."]);
          break;

        case 'webrtc_offer':
          console.log('[Mesh3] Received WebRTC offer');
          
          // Only responder should handle offers
          if (peerRole !== 'responder') {
            console.warn('[Mesh3] Ignoring offer - not a responder');
            return;
          }

          // Prevent processing multiple offers simultaneously
          if (isProcessingOffer) {
            console.warn('[Mesh3] Already processing an offer, ignoring');
            return;
          }

          setIsProcessingOffer(true);
          setMessages((prev) => [...prev, "🤝 Received connection offer, creating answer..."]);

          try {
            // Check if we're in the right state to receive an offer
            const signalingState = peer.peerRef?.current?.signalingState;
            if (signalingState !== 'stable' && signalingState !== undefined) {
              console.warn('[Mesh3] Not in stable state, current state:', signalingState);
              // Reset peer connection if in wrong state
              peer.reset();
              // Brief delay to ensure cleanup
              await new Promise(resolve => setTimeout(resolve, 100));
            }

            await peer.setRemoteDescription(msg.offer);
            const answer = await peer.createAnswer();
            
            console.log('[Mesh3] Sending answer...');
            sendSocketMessageRef.current({ 
              type: 'webrtc_answer', 
              room_id: roomId, 
              answer 
            });
            
            setMessages((prev) => [...prev, "📤 Sent connection answer"]);
            
          } catch (error) {
            console.error('[Mesh3] Error processing offer:', error);
            setMessages((prev) => [...prev, `❌ Failed to process offer: ${error.message}`]);
          } finally {
            setIsProcessingOffer(false);
          }
          break;

        case 'webrtc_answer':
          console.log('[Mesh3] Received WebRTC answer');
          
          // Only initiator should handle answers
          if (peerRole !== 'initiator') {
            console.warn('[Mesh3] Ignoring answer - not an initiator');
            return;
          }

          setMessages((prev) => [...prev, "🤝 Received connection answer, establishing connection..."]);

          try {
            // Check if we're in the right state to receive an answer
            const signalingState = peer.peerRef?.current?.signalingState;
            if (signalingState !== 'have-local-offer') {
              console.warn('[Mesh3] Not in have-local-offer state, current state:', signalingState);
              return;
            }

            await peer.setRemoteDescription(msg.answer);
            setMessages((prev) => [...prev, "✅ Connection negotiation complete"]);
            
          } catch (error) {
            console.error('[Mesh3] Error processing answer:', error);
            setMessages((prev) => [...prev, `❌ Failed to process answer: ${error.message}`]);
          }
          break;

        case 'ice_candidate':
          console.log('[Mesh3] Received ICE candidate');
          try {
            await peer.addIceCandidate(msg.candidate);
          } catch (error) {
            console.error('[Mesh3] Error adding ICE candidate:', error);
          }
          break;

        default:
          console.warn('[Mesh3] Unknown message type:', msg.type);
      }
    } catch (err) {
      console.error('[Mesh3] Error handling signal message:', err);
      setMessages((prev) => [...prev, `❌ Signal Error: ${err.message || err}`]);
    }
  }, [peer, roomId, peerRole, isProcessingOffer]);

  const { sendMessage: sendSocketMessage, connected: wsConnected } = useWebSocket(joined ? roomId : null, handleSignalMessage);
  
  // Update the ref when sendSocketMessage changes
  useEffect(() => {
    sendSocketMessageRef.current = sendSocketMessage;
  }, [sendSocketMessage]);

  // Reset state when room changes
  useEffect(() => {
    if (!joined) {
      setPeerRole(null);
      setIsProcessingOffer(false);
      setPeerReady(false);
      setConnectionAttempts(0);
      setIsReconnecting(false);
    }
  }, [roomId, joined]);

  // Auto-create offer when we are initiator and peer is ready
  useEffect(() => {
    if (peerRole === 'initiator' && peerReady && peer.isConfigReady && !isReconnecting) {
      const createOfferDelayed = async () => {
        // Wait a bit to ensure peer connection is stable
        await new Promise(resolve => setTimeout(resolve, 500));
        
        try {
          console.log('[Mesh3] Creating offer as initiator...');
          setMessages((prev) => [...prev, "📡 Creating connection offer..."]);
          
          const offer = await peer.createOffer();
          sendSocketMessageRef.current({ 
            type: 'webrtc_offer', 
            room_id: roomId, 
            offer 
          });
          
          setMessages((prev) => [...prev, "📤 Sent connection offer"]);
          
        } catch (err) {
          console.error('[Mesh3] Error creating offer:', err);
          setMessages((prev) => [...prev, `❌ Offer Error: ${err.message}`]);
        }
      };
      
      createOfferDelayed();
    }
  }, [peerRole, peerReady, peer.isConfigReady, roomId, isReconnecting]);

  const handleJoin = useCallback(async () => {
    if (!walletAddress || !roomId) return;

    // Reset previous session
    peer.reset();
    setMessages([]);
    setEncryptionError(null);
    setPeerRole(null);
    setIsProcessingOffer(false);
    setPeerReady(false);
    setConnectionAttempts(0);
    setIsReconnecting(false);

    sendSocketMessage({ type: 'join_room', room_id: roomId });
    setJoined(true);
    setMessages((prev) => [...prev, `🌐 Joining room ${roomId}...`]);
  }, [walletAddress, roomId, peer, sendSocketMessage]);

  const handleLeave = useCallback(() => {
    peer.reset();
    setJoined(false);
    setMessages([]);
    setEncryptionError(null);
    setPeerRole(null);
    setIsProcessingOffer(false);
    setPeerReady(false);
    setConnectionAttempts(0);
    setIsReconnecting(false);
    setMessages((prev) => [...prev, "👋 Left the room"]);
  }, [peer]);

  const handleSend = useCallback(async () => {
    if (!input.trim()) return;
    
    const messageToSend = input.trim();
    
    try {
      await peer.sendMessage(messageToSend);
      
      const prefix = peer.encryptionEnabled ? "🔒 You: " : "📢 You: ";
      setMessages((prev) => [...prev, prefix + messageToSend]);
      setInput('');
    } catch (error) {
      console.error('[Mesh3] Failed to send message:', error);
      setMessages((prev) => [...prev, `❌ Failed to send message: ${error.message}`]);
    }
  }, [input, peer]);

  const handleKeyPress = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const generateRandomRoomId = useCallback(() => {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
      result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    setRoomId(`room_${result}`);
  }, []);

  const copyRoomId = useCallback(() => {
    navigator.clipboard.writeText(roomId);
    setMessages((prev) => [...prev, "📋 Room ID copied to clipboard"]);
  }, [roomId]);

  const getEncryptionStatusText = () => {
    switch (peer.encryptionStatus) {
      case 'none':
        return '🔓 No encryption';
      case 'generating':
        return '🔄 Generating keys...';
      case 'exchanging':
        return '🤝 Exchanging keys...';
      case 'ready':
        return '🔐 End-to-end encrypted';
      case 'error':
        return '❌ Encryption failed';
      default:
        return '🔓 Unknown status';
    }
  };

  const getEncryptionStatusColor = () => {
    switch (peer.encryptionStatus) {
      case 'ready':
        return 'text-green-600';
      case 'error':
        return 'text-red-600';
      case 'generating':
      case 'exchanging':
        return 'text-yellow-600';
      default:
        return 'text-gray-600';
    }
  };

  const getConnectionStatusText = () => {
    if (isReconnecting) return '🔄 Reconnecting...';
    if (!wsConnected) return '🔴 WebSocket disconnected';
    if (peer.isConnected) return '🟢 Connected to peer';
    if (peerRole === 'initiator' && !peerReady) return '🟡 Waiting for peer to join...';
    if (peerRole === 'responder') return '🟡 Waiting for connection...';
    return '🟡 Establishing connection...';
  };

  const getConnectionStatusColor = () => {
    if (isReconnecting) return 'text-yellow-600';
    if (!wsConnected) return 'text-red-600';
    if (peer.isConnected) return 'text-green-600';
    return 'text-yellow-600';
  };

  return (
    <main className="flex flex-col items-center justify-center min-h-screen p-4 bg-gray-50">
      <div className="w-full max-w-4xl">
        <h1 className="text-4xl font-bold mb-8 text-center text-gray-800">
          🔐 Mesh3 Secure Chat
        </h1>

        {/* Wallet Connection */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">🦊 Wallet Connection</h2>
          
          {!walletAddress ? (
            <button
              onClick={connectWallet}
              disabled={isConnecting}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isConnecting ? 'Connecting...' : 'Connect MetaMask'}
            </button>
          ) : (
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <span className="text-green-600">✅ Connected:</span>
                <code className="bg-gray-100 px-2 py-1 rounded text-sm">
                  {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
                </code>
              </div>
              <div className="text-sm text-gray-500">
                Network: Ethereum
              </div>
            </div>
          )}
          
          {error && (
            <div className="mt-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
              {error}
            </div>
          )}
        </div>

        {/* Room Setup */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">🏠 Room Setup</h2>
          
          <div className="space-y-4">
            <div className="flex space-x-2">
              <input
                type="text"
                placeholder="Enter Room ID (e.g., room_abc123)"
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                disabled={joined}
              />
              <button
                onClick={generateRandomRoomId}
                disabled={joined}
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                🎲 Random
              </button>
            </div>
            
            <div className="flex space-x-2">
              <button
                onClick={handleJoin}
                disabled={!walletAddress || !roomId || joined}
                className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {joined ? 'Joined' : 'Join Room'}
              </button>
              
              {joined && (
                <button
                  onClick={handleLeave}
                  className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  Leave Room
                </button>
              )}
              
              {roomId && (
                <button
                  onClick={copyRoomId}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  📋 Copy ID
                </button>
              )}
            </div>
          </div>

          {/* Peer Role Display */}
          {peerRole && (
            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <span className="text-sm text-blue-700">
                📡 Role: <strong>{peerRole}</strong>
                {peerRole === 'initiator' ? ' (will create offer)' : ' (will wait for offer)'}
                {peerRole === 'initiator' && peerReady && ' - Peer Ready!'}
              </span>
            </div>
          )}

          {/* Encryption Controls */}
          <div className="flex items-center justify-between pt-4 border-t">
            <div className="flex items-center space-x-4">
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={peer.encryptionEnabled}
                  onChange={(e) => peer.setEncryptionEnabled(e.target.checked)}
                  disabled={joined}
                  className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">Enable End-to-End Encryption</span>
              </label>
            </div>
            
            <div className={`text-sm font-medium ${getEncryptionStatusColor()}`}>
              {getEncryptionStatusText()}
            </div>
          </div>
        </div>

        {/* Chat Interface */}
        {joined && (
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">💬 Chat</h2>
              <div className={`text-sm font-medium ${getConnectionStatusColor()}`}>
                {getConnectionStatusText()}
              </div>
            </div>
            
            {/* Connection Status Alerts */}
            {connectionAttempts > 0 && (
              <div className="mb-4 p-3 bg-yellow-100 border border-yellow-400 text-yellow-700 rounded-lg">
                <strong>⚠️ Connection Issues:</strong> Reconnection attempt {connectionAttempts}/{maxConnectionAttempts}
              </div>
            )}
            
            {/* Encryption Status Alert */}
            {encryptionError && (
              <div className="mb-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded-lg">
                <strong>⚠️ Encryption Error:</strong> {encryptionError}
              </div>
            )}
            
            {peer.encryptionEnabled && peer.encryptionStatus === 'ready' && (
              <div className="mb-4 p-4 bg-green-100 border border-green-400 text-green-700 rounded-lg">
                <strong>🔐 Secure:</strong> All messages are end-to-end encrypted using ECDH + AES-GCM.
              </div>
            )}

            {/* Messages */}
            <div className="border rounded-lg p-4 h-80 overflow-y-auto bg-gray-50 mb-4 space-y-2">
              {messages.length === 0 ? (
                <div className="text-gray-500 text-center py-8">
                  No messages yet. Start a conversation!
                </div>
              ) : (
                messages.map((msg, i) => (
                  <div key={i} className="text-sm">
                    {msg.startsWith('🔒') || msg.startsWith('📢') ? (
                      <div className="bg-white p-3 rounded-lg border-l-4 border-blue-500 shadow-sm">
                        {msg}
                      </div>
                    ) : msg.startsWith('🔐') || msg.startsWith('❌') || msg.startsWith('📡') || msg.startsWith('🤝') || msg.startsWith('📤') || msg.startsWith('✅') || msg.startsWith('🟢') || msg.startsWith('🔴') || msg.startsWith('🟡') || msg.startsWith('🔄') || msg.startsWith('📋') || msg.startsWith('👋') ? (
                      <div className="bg-blue-50 p-2 rounded text-center text-xs text-blue-700">
                        {msg}
                      </div>
                    ) : (
                      <div className="bg-gray-100 p-2 rounded">
                        {msg}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Message Input */}
            <div className="flex space-x-2">
              <input
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder={peer.isConnected ? "Type a message..." : "Waiting for peer connection..."}
                disabled={!peer.isConnected}
              />
              <button
                className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                onClick={handleSend}
                disabled={!peer.isConnected || !input.trim()}
              >
                Send
              </button>
            </div>

            {/* Detailed Status */}
            <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
              <div className="bg-gray-50 p-3 rounded-lg">
                <div className="font-medium text-gray-700 mb-1">Connection Status</div>
                <div className={getConnectionStatusColor()}>
                  {getConnectionStatusText()}
                </div>
                {peerRole && (
                  <div className="text-gray-600 mt-1">
                    Role: {peerRole}
                  </div>
                )}
              </div>
              
              <div className="bg-gray-50 p-3 rounded-lg">
                <div className="font-medium text-gray-700 mb-1">Security Status</div>
                <div className={getEncryptionStatusColor()}>
                  {getEncryptionStatusText()}
                </div>
                {peer.encryptionEnabled && peer.encryptionStatus === 'ready' && (
                  <div className="text-green-600 mt-1 text-xs">
                    ECDH + AES-GCM
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}