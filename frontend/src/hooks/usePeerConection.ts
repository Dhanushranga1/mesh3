// usePeerConnection.ts - Fixed version with enhanced ICE candidate handling

'use client';

import { useEffect, useRef, useState } from 'react';
import useEncryption, { EncryptedMessage } from './useEncryption';

type PeerEvents = {
  onMessage: (msg: string) => void;
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
  onEncryptionReady?: () => void;
  onEncryptionError?: (error: string) => void;
  onIceCandidate?: (candidate: RTCIceCandidate) => void;
};

const METERED_API_KEY = '4a8fac60444f7114f27684e16ca295121f2b';

export default function usePeerConnection(events: PeerEvents) {
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [encryptionStatus, setEncryptionStatus] = useState<'none' | 'generating' | 'exchanging' | 'ready' | 'error'>('none');
  const [rtcConfig, setRtcConfig] = useState<RTCConfiguration | null>(null);
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>('new');
  const [iceConnectionState, setIceConnectionState] = useState<RTCIceConnectionState>('new');
  const [iceGatheringState, setIceGatheringState] = useState<RTCIceGatheringState>('new');
  
  // Queue for ICE candidates received before remote description is set
  const iceCandidateQueue = useRef<RTCIceCandidateInit[]>([]);
  
  const encryption = useEncryption();

    // Fetch TURN credentials on mount
  useEffect(() => {
    const staticConfig: RTCConfiguration = {
      iceServers: [
        { urls: "stun:stun.relay.metered.ca:80" },
        {
          urls: "turn:global.relay.metered.ca:80",
          username: "9ae98ce56353c5ed88502088",
          credential: "yhES9u6IW5+WTSgc",
        },
        {
          urls: "turn:global.relay.metered.ca:80?transport=tcp",
          username: "9ae98ce56353c5ed88502088",
          credential: "yhES9u6IW5+WTSgc",
        },
        {
          urls: "turn:global.relay.metered.ca:443",
          username: "9ae98ce56353c5ed88502088",
          credential: "yhES9u6IW5+WTSgc",
        },
        {
          urls: "turns:global.relay.metered.ca:443?transport=tcp",
          username: "9ae98ce56353c5ed88502088",
          credential: "yhES9u6IW5+WTSgc",
        },
      ],
      iceCandidatePoolSize: 10,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
      iceTransportPolicy: 'all',
    };

    setRtcConfig(staticConfig);
    console.log('[TURN] Using static TURN config from Metered');
  }, []);


  const handleIncomingMessage = async (data: string) => {
    try {
      const parsed = JSON.parse(data);

      if (parsed.type === 'key_exchange') {
        console.log('[PeerConnection] Received public key from peer');
        setEncryptionStatus('exchanging');

        try {
          await encryption.deriveSharedKey(parsed.publicKey);
          setEncryptionStatus('ready');
          events.onEncryptionReady?.();
          console.log('[PeerConnection] Encryption ready!');
        } catch (error) {
          console.error('[PeerConnection] Key exchange failed:', error);
          setEncryptionStatus('error');
          events.onEncryptionError?.('Key exchange failed');
        }
        return;
      }

      if (parsed.type === 'encrypted_message') {
        try {
          const decryptedMessage = await encryption.decryptMessage(parsed.message);
          events.onMessage(decryptedMessage);
        } catch (error) {
          console.error('[PeerConnection] Failed to decrypt message:', error);
          events.onEncryptionError?.('Failed to decrypt message');
        }
        return;
      }
    } catch (e) {
      if (!encryption.encryptionEnabled) {
        events.onMessage(data);
        return;
      }

      console.warn('[PeerConnection] Received non-JSON message when encryption is enabled');
      events.onEncryptionError?.('Received unencrypted message');
    }
  };

  const processQueuedIceCandidates = async () => {
    if (!peerRef.current || !peerRef.current.remoteDescription) {
      return;
    }

    console.log(`[ICE] Processing ${iceCandidateQueue.current.length} queued candidates`);
    
    for (const candidate of iceCandidateQueue.current) {
      try {
        await peerRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        console.log('[ICE] Added queued candidate successfully');
      } catch (error) {
        console.error('[ICE] Failed to add queued candidate:', error);
      }
    }
    
    iceCandidateQueue.current = [];
  };

  const createConnection = () => {
    if (!rtcConfig) {
      console.warn('[PeerConnection] Cannot create connection: RTC config not ready');
      return;
    }

    if (peerRef.current) {
      console.log('[PeerConnection] Closing existing connection');
      peerRef.current.close();
    }

    console.log('[PeerConnection] Creating new RTCPeerConnection');
    peerRef.current = new RTCPeerConnection(rtcConfig);

    // Enhanced ICE candidate handling
    peerRef.current.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('[ICE] New local candidate:', {
          candidate: event.candidate.candidate,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
          sdpMid: event.candidate.sdpMid
        });
        
        // Send candidate to other peer via signaling
        events.onIceCandidate?.(event.candidate);
      } else {
        console.log('[ICE] Local candidate gathering complete');
      }
    };

    // Enhanced ICE connection state monitoring
    peerRef.current.oniceconnectionstatechange = () => {
      const state = peerRef.current!.iceConnectionState;
      console.log('[ICE] Connection state changed:', state);
      setIceConnectionState(state);
      
      switch (state) {
        case 'connected':
          console.log('[ICE] ✅ ICE connection established');
          break;
        case 'disconnected':
          console.warn('[ICE] ⚠️ ICE connection disconnected - attempting to reconnect');
          // Don't immediately fail, give it time to reconnect
          setTimeout(() => {
            if (peerRef.current?.iceConnectionState === 'disconnected') {
              console.log('[ICE] Still disconnected after timeout, attempting restart');
              peerRef.current?.restartIce();
            }
          }, 5000);
          break;
        case 'failed':
          console.error('[ICE] ❌ ICE connection failed - attempting restart');
          peerRef.current?.restartIce();
          break;
        case 'closed':
          console.log('[ICE] ICE connection closed');
          setIsConnected(false);
          break;
      }
    };

    // Enhanced ICE gathering state monitoring
    peerRef.current.onicegatheringstatechange = () => {
      const state = peerRef.current!.iceGatheringState;
      console.log('[ICE] Gathering state changed:', state);
      setIceGatheringState(state);
      
      if (state === 'complete') {
        console.log('[ICE] ✅ ICE candidate gathering complete');
      }
    };

    // Data channel handling for responder
    peerRef.current.ondatachannel = (event) => {
      const channel = event.channel;
      dataChannelRef.current = channel;
      console.log('[DataChannel] Received data channel:', channel.label);
      setupDataChannel(channel);
    };

    // Enhanced connection state monitoring
    peerRef.current.onconnectionstatechange = () => {
      const state = peerRef.current?.connectionState;
      console.log('[PeerConnection] Connection state changed:', state);
      setConnectionState(state || 'new');
      events.onConnectionStateChange?.(state!);
      
      switch (state) {
        case 'connected':
          console.log('[PeerConnection] ✅ Peer connection established');
          setIsConnected(true);
          break;
        case 'disconnected':
          console.warn('[PeerConnection] ⚠️ Peer connection disconnected');
          // Don't immediately set as disconnected, give it time
          setTimeout(() => {
            if (peerRef.current?.connectionState === 'disconnected') {
              console.log('[PeerConnection] Still disconnected after timeout');
              setIsConnected(false);
            }
          }, 5000);
          break;
        case 'failed':
          console.error('[PeerConnection] ❌ Peer connection failed');
          setIsConnected(false);
          break;
        case 'closed':
          console.log('[PeerConnection] Peer connection closed');
          setIsConnected(false);
          break;
      }
    };

    // Signaling state monitoring
    peerRef.current.onsignalingstatechange = () => {
      const state = peerRef.current!.signalingState;
      console.log('[PeerConnection] Signaling state changed:', state);
      
      // Process queued ICE candidates when remote description is set
      if (state === 'stable' || state === 'have-remote-offer') {
        processQueuedIceCandidates();
      }
    };
  };

  const setupDataChannel = (channel: RTCDataChannel) => {
    channel.onmessage = (e) => {
      console.log('[DataChannel] Received message:', e.data);
      handleIncomingMessage(e.data);
    };

    channel.onopen = async () => {
      console.log('[DataChannel] ✅ Data channel opened');
      setIsConnected(true);
      
      if (encryption.encryptionEnabled) {
        await initiateKeyExchange();
      }
    };

    channel.onclose = () => {
      console.log('[DataChannel] ❌ Data channel closed');
      setIsConnected(false);
      setEncryptionStatus('none');
    };

    channel.onerror = (error) => {
      console.error('[DataChannel] Error:', error);
      setIsConnected(false);
    };
  };

  const initiateKeyExchange = async () => {
    if (!encryption.encryptionEnabled) return;

    try {
      setEncryptionStatus('generating');
      console.log('[PeerConnection] Starting key exchange...');
      const publicKey = await encryption.generateKeyPair();

      const keyExchangeMessage = {
        type: 'key_exchange',
        publicKey,
      };

      if (dataChannelRef.current?.readyState === 'open') {
        dataChannelRef.current.send(JSON.stringify(keyExchangeMessage));
        console.log('[PeerConnection] Sent public key to peer');
      } else {
        console.warn('[PeerConnection] Data channel not open for key exchange');
      }
    } catch (error) {
      console.error('[PeerConnection] Key exchange initiation failed:', error);
      setEncryptionStatus('error');
      events.onEncryptionError?.('Failed to initiate key exchange');
    }
  };

  const createOffer = async (): Promise<RTCSessionDescriptionInit> => {
    if (!rtcConfig) {
      throw new Error('RTC config not loaded');
    }
    
    createConnection();
    
    // Create data channel with enhanced configuration
    const channel = peerRef.current!.createDataChannel('chat', {
      ordered: true,
      maxRetransmits: 3
    });
    dataChannelRef.current = channel;
    setupDataChannel(channel);

    // Wait for ICE gathering to complete or timeout
    const gatheringPromise = new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        console.log('[ICE] Gathering timeout, proceeding with partial candidates');
        resolve();
      }, 10000); // 10 second timeout

      const checkGathering = () => {
        if (peerRef.current?.iceGatheringState === 'complete') {
          clearTimeout(timeout);
          resolve();
        } else {
          setTimeout(checkGathering, 100);
        }
      };
      checkGathering();
    });

    // Create offer with proper constraints
    const offer = await peerRef.current!.createOffer({
      offerToReceiveAudio: false,
      offerToReceiveVideo: false
    });
    
    await peerRef.current!.setLocalDescription(offer);
    
    // Wait for some ICE candidates to be gathered
    await Promise.race([
      gatheringPromise,
      new Promise(resolve => setTimeout(resolve, 3000)) // At least 3 seconds
    ]);
    
    console.log('[PeerConnection] Offer created with ICE candidates');
    return peerRef.current!.localDescription!;
  };

  const createAnswer = async (): Promise<RTCSessionDescriptionInit> => {
    if (!rtcConfig) {
      throw new Error('RTC config not loaded');
    }

    if (!peerRef.current) {
      throw new Error('Peer connection not available for answer');
    }

    const answer = await peerRef.current.createAnswer();
    await peerRef.current.setLocalDescription(answer);
    
    // Wait for some ICE candidates to be gathered
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('[PeerConnection] Answer created with ICE candidates');
    return peerRef.current.localDescription!;
  };

  const setRemoteDescription = async (desc: RTCSessionDescriptionInit) => {
    if (!peerRef.current) {
      console.log('[PeerConnection] Creating peer connection for remote description');
      createConnection();
    }

    if (!peerRef.current) {
      throw new Error('Failed to create peer connection');
    }

    console.log('[PeerConnection] Setting remote description:', desc.type);
    
    // Ensure we're in the correct state
    if (peerRef.current.signalingState === 'closed') {
      throw new Error('Peer connection is closed');
    }

    await peerRef.current.setRemoteDescription(new RTCSessionDescription(desc));
    console.log('[PeerConnection] ✅ Remote description set successfully');
    
    // Process any queued ICE candidates
    await processQueuedIceCandidates();
  };

  const addIceCandidate = async (candidate: RTCIceCandidateInit) => {
    if (!peerRef.current) {
      console.warn('[ICE] Cannot add candidate: No peer connection');
      return;
    }

    console.log('[ICE] Attempting to add candidate:', candidate.candidate);

    if (peerRef.current.remoteDescription) {
      try {
        await peerRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        console.log('[ICE] ✅ Candidate added successfully');
      } catch (error) {
        console.error('[ICE] ❌ Failed to add candidate:', error);
        // Don't throw - some candidates might be incompatible
      }
    } else {
      console.log('[ICE] Queueing candidate (no remote description yet)');
      iceCandidateQueue.current.push(candidate);
    }
  };

  const sendMessage = async (message: string) => {
    if (!dataChannelRef.current || dataChannelRef.current.readyState !== 'open') {
      console.warn('[PeerConnection] Cannot send message: DataChannel not open, state:', dataChannelRef.current?.readyState);
      return;
    }

    try {
      if (encryption.encryptionEnabled && encryptionStatus === 'ready') {
        const encryptedMessage = await encryption.encryptMessage(message);
        const payload = {
          type: 'encrypted_message',
          message: encryptedMessage
        };
        dataChannelRef.current.send(JSON.stringify(payload));
        console.log('[PeerConnection] Sent encrypted message');
      } else if (!encryption.encryptionEnabled) {
        dataChannelRef.current.send(message);
        console.log('[PeerConnection] Sent plain message');
      } else {
        console.warn('[PeerConnection] Cannot send message: Encryption not ready');
        events.onEncryptionError?.('Encryption not ready. Please wait for key exchange.');
      }
    } catch (error) {
      console.error('[PeerConnection] Failed to send message:', error);
      events.onEncryptionError?.('Failed to send message');
    }
  };

  const reset = () => {
    console.log('[PeerConnection] Resetting connection');
    
    if (peerRef.current) {
      peerRef.current.close();
      peerRef.current = null;
    }
    if (dataChannelRef.current) {
      dataChannelRef.current.close();
      dataChannelRef.current = null;
    }
    
    // Clear ICE candidate queue
    iceCandidateQueue.current = [];
    
    setIsConnected(false);
    setConnectionState('new');
    setIceConnectionState('new');
    setIceGatheringState('new');
    setEncryptionStatus('none');
    encryption.resetEncryption();
    
    console.log('[PeerConnection] ✅ Connection reset complete');
  };

  return {
    createOffer,
    createAnswer,
    setRemoteDescription,
    addIceCandidate,
    sendMessage,
    reset,
    isConnected,
    encryptionStatus,
    encryptionEnabled: encryption.encryptionEnabled,
    setEncryptionEnabled: encryption.setEncryptionEnabled,
    connectionState,
    iceConnectionState,
    iceGatheringState,
    isConfigReady: !!rtcConfig,
    peerRef,
  };
}