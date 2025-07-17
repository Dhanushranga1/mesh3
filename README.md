
## Mesh3: Merkle-Enforced Secure Handshake 3


**Mesh3** is a secure, decentralized chat application built using WebRTC and Web3 technologies. It provides real-time, end-to-end encrypted peer-to-peer communication between users authenticated via blockchain wallets.

This project is designed for privacy, resilience, and censorship resistance—offering an alternative to centralized messaging systems with minimal reliance on servers.

---

## Overview

Mesh3 enables two users to securely exchange messages over a peer-to-peer connection authenticated by their MetaMask wallets. Messages are encrypted using symmetric encryption (AES-GCM) with keys derived from ephemeral public-key exchanges. The application is powered by WebRTC DataChannels, FastAPI WebSocket signaling, and dynamic STUN/TURN negotiation using Metered’s TURN infrastructure.

---

## Key Features

- **End-to-End Encrypted Messaging**  
  Messages are encrypted client-side using AES-GCM, ensuring confidentiality across the full transmission path.

- **MetaMask Wallet Authentication**  
  Wallet-based sign-in for decentralized identity verification. No usernames, no passwords, no databases.

- **Peer-to-Peer WebRTC Messaging**  
  Real-time chat via direct WebRTC DataChannels, falling back to TURN only when direct NAT traversal fails.

- **Secure Key Exchange**  
  Encryption keys are derived using runtime-generated key pairs with secure exchange over the signaling channel.

- **No Centralized Storage**  
  No messages or credentials are ever saved on the server. All data exists temporarily in RAM during sessions.

---

## Technology Stack

### Frontend

- Next.js (App Router)
- React 19
- Tailwind CSS
- MetaMask Integration
- WebRTC API
- AES-GCM Encryption (via SubtleCrypto)

### Backend

- Python (FastAPI)
- WebSocket-based signaling
- Stateless peer room matching
- Metered TURN/STUN service for fallback relay support

---

## How It Works

1. Users authenticate using MetaMask.
2. One peer initiates the connection, the other joins the same room via WebSocket signaling.
3. A WebRTC peer-to-peer channel is established between both browsers.
4. Messages are encrypted and transmitted over the DataChannel.
5. TURN/STUN servers are used only when direct connection fails.

---

## Setup Instructions

### Prerequisites

- Node.js and npm
- Python 3.9+
- MetaMask installed in your browser
- Modern Chromium-based browser (Chrome, Edge, Brave)

### Run Locally

```bash
# Clone the repository
git clone https://github.com/your-username/mesh3.git
cd mesh3

# Start the backend
cd backend
backend git:(main) uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Start the frontend
cd ../frontend
npm install
npm run dev
```

---



A simplified flow:

- User A connects → FastAPI WebSocket → Signaling begins
- User B joins same room → SDP offer/answer exchanged
- TURN server assists if direct peer connection fails
- Encrypted chat over DataChannel begins

---

## Future Development

The current implementation is a Secure MVP. Future enhancements include:

- Progressive Web App (PWA) support for mobile usage
- Group chat via multi-peer mesh relays
- File sharing over WebRTC
- Offline-first messaging fallback via distributed hash tables (DHT)
- Integration with decentralized identity protocols (e.g., ENS, DIDs)
- Smart contract-based relay incentives and usage credits
- Video/audio calling with encryption
- End-to-end test suites and UI improvements

---

## Security Principles

- **Zero trust model:** Encryption is applied before transmission, even for fallback relay via TURN.
- **Ephemeral keys:** No long-term storage of cryptographic material.
- **No logs:** No chat history is retained on client or server.
- **Authenticated connections:** Wallet signature verifies user identity.

---

## License

This project is licensed under the [MIT License](LICENSE).

---

## Acknowledgements

- WebRTC Working Group
- Metered.ca for TURN/STUN infrastructure
- Ethereum Foundation for MetaMask
- Mozilla MDN for encryption and WebRTC documentation
