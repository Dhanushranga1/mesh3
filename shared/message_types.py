# Shared message type definitions for MESH3 project

from typing import Dict, Any, Literal, Optional
from pydantic import BaseModel

# WebSocket message types
class JoinRoomMessage(BaseModel):
    type: Literal["join_room"]
    room_id: str

class RoomJoinedMessage(BaseModel):
    type: Literal["room_joined"]
    room_id: str
    peer_count: int

class PeerReadyMessage(BaseModel):
    type: Literal["peer_ready"]
    room_id: str

class WebRTCOfferMessage(BaseModel):
    type: Literal["webrtc_offer"]
    room_id: str
    offer: Dict[str, Any]

class WebRTCAnswerMessage(BaseModel):
    type: Literal["webrtc_answer"]
    room_id: str
    answer: Dict[str, Any]

class ICECandidateMessage(BaseModel):
    type: Literal["ice_candidate"]
    room_id: str
    candidate: Dict[str, Any]

class ErrorMessage(BaseModel):
    type: Literal["error"]
    message: str

# Data channel message types
class KeyExchangeMessage(BaseModel):
    type: Literal["key_exchange"]
    publicKey: Dict[str, Any]

class EncryptedMessage(BaseModel):
    type: Literal["encrypted_message"]
    message: Dict[str, str]  # Contains 'data' and 'iv' fields

# Union types for message validation
SignalingMessage = (
    JoinRoomMessage | 
    RoomJoinedMessage | 
    PeerReadyMessage | 
    WebRTCOfferMessage | 
    WebRTCAnswerMessage | 
    ICECandidateMessage | 
    ErrorMessage
)

DataChannelMessage = (
    KeyExchangeMessage |
    EncryptedMessage
)
