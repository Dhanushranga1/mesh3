# backend/main.py

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict, List
import json
import logging

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# Enable CORS for local frontend dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten in prod
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Room ID → List of WebSocket connections
rooms: Dict[str, List[WebSocket]] = {}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    room_id = None
    
    logger.info(f"New WebSocket connection accepted")

    try:
        while True:
            raw_data = await websocket.receive_text()
            try:
                data = json.loads(raw_data)
                msg_type = data.get("type")
                current_room_id = data.get("room_id")

                logger.info(f"Received message: {msg_type} for room: {current_room_id}")

                if not msg_type or not current_room_id:
                    await websocket.send_text(json.dumps({"error": "Invalid message format"}))
                    continue

                if msg_type == "join_room":
                    # Remove from previous room if exists
                    if room_id and room_id in rooms and websocket in rooms[room_id]:
                        rooms[room_id].remove(websocket)
                        if not rooms[room_id]:
                            del rooms[room_id]
                            logger.info(f"Deleted empty room: {room_id}")
                    
                    room_id = current_room_id
                    
                    # Create room if it doesn't exist
                    if room_id not in rooms:
                        rooms[room_id] = []
                    
                    # Add peer to room if not already present
                    if websocket not in rooms[room_id]:
                        rooms[room_id].append(websocket)
                        peer_count = len(rooms[room_id])
                        logger.info(f"User joined room: {room_id} | Total peers: {peer_count}")
                        
                        # Send role information back to the joining peer ONLY
                        await websocket.send_text(json.dumps({
                            "type": "room_joined",
                            "room_id": room_id,
                            "peer_count": peer_count
                        }))
                        
                        # If this is the second peer, notify the first peer to start offer creation
                        if peer_count == 2:
                            # Find the first peer (initiator) and notify them
                            for peer_conn in rooms[room_id]:
                                if peer_conn != websocket:  # This is the first peer
                                    try:
                                        await peer_conn.send_text(json.dumps({
                                            "type": "peer_ready",
                                            "room_id": room_id
                                        }))
                                        logger.info(f"Notified initiator that responder is ready in room {room_id}")
                                        break
                                    except Exception as e:
                                        logger.error(f"Failed to notify initiator: {e}")
                    else:
                        logger.warning(f"Peer already in room {room_id}, ignoring duplicate join")
                    
                elif msg_type in ["webrtc_offer", "webrtc_answer", "ice_candidate"]:
                    # These are WebRTC signaling messages that should be forwarded to other peers
                    room_id = current_room_id
                    
                    if room_id not in rooms:
                        logger.warning(f"Received {msg_type} for non-existent room: {room_id}")
                        continue
                    
                    # Forward to all OTHER peers in the room
                    peers_in_room = rooms[room_id]
                    forwarded_count = 0
                    
                    for peer_conn in peers_in_room:
                        if peer_conn != websocket:  # Don't send back to sender
                            try:
                                await peer_conn.send_text(raw_data)
                                forwarded_count += 1
                                logger.info(f"Forwarded {msg_type} to peer in room {room_id}")
                            except Exception as e:
                                logger.error(f"Failed to forward message to peer: {e}")
                                # Remove failed connections
                                try:
                                    rooms[room_id].remove(peer_conn)
                                except ValueError:
                                    pass
                    
                    logger.info(f"Forwarded {msg_type} to {forwarded_count} peers in room {room_id}")
                    
                else:
                    logger.warning(f"Unknown message type: {msg_type}")
                    
            except json.JSONDecodeError:
                logger.error(f"Invalid JSON received: {raw_data}")
                await websocket.send_text(json.dumps({"error": "Invalid JSON"}))
                
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
        
        # Clean up: remove from room
        if room_id and room_id in rooms:
            if websocket in rooms[room_id]:
                rooms[room_id].remove(websocket)
                logger.info(f"Removed user from room: {room_id} | Remaining: {len(rooms[room_id])}")
                
            # Delete room if empty
            if not rooms[room_id]:
                del rooms[room_id]
                logger.info(f"Deleted empty room: {room_id}")
                
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        if room_id and room_id in rooms and websocket in rooms[room_id]:
            rooms[room_id].remove(websocket)
            if not rooms[room_id]:
                del rooms[room_id]