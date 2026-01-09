// Simple WebSocket signaling server for Netlify Functions
// No npm required - works with Netlify's built-in Node.js

// In-memory room storage (clears on function cold start)
const rooms = {};

// Helper to clean old rooms
function cleanupRooms() {
    const now = Date.now();
    const timeout = 30 * 60 * 1000; // 30 minutes
    
    for (const roomId in rooms) {
        if (now - rooms[roomId].lastActivity > timeout) {
            delete rooms[roomId];
        }
    }
}

exports.handler = async (event, context) => {
    // Handle WebSocket connections
    if (event.requestContext) {
        const routeKey = event.requestContext.routeKey;
        const connectionId = event.requestContext.connectionId;
        const domain = event.requestContext.domainName;
        const stage = event.requestContext.stage;
        
        // For WebSocket API messages
        if (routeKey === '$connect') {
            // Connection established
            const roomId = event.queryStringParameters?.room || 'default';
            
            // Initialize room if not exists
            if (!rooms[roomId]) {
                rooms[roomId] = {
                    users: [],
                    createdAt: Date.now(),
                    lastActivity: Date.now()
                };
            }
            
            const room = rooms[roomId];
            
            // Check if room is full (max 2 users)
            if (room.users.length >= 2) {
                return {
                    statusCode: 400,
                    body: JSON.stringify({ 
                        type: 'room-full',
                        message: 'Room is full (max 2 users)' 
                    })
                };
            }
            
            // Add user to room
            room.users.push({
                connectionId,
                joinedAt: Date.now(),
                isInitiator: room.users.length === 0 // First user is initiator
            });
            
            room.lastActivity = Date.now();
            
            console.log(`User ${connectionId} joined room ${roomId}`);
            
            return {
                statusCode: 200,
                body: JSON.stringify({ 
                    type: 'welcome',
                    room: roomId,
                    isInitiator: room.users.length === 1,
                    message: 'Connected to room'
                })
            };
        }
        
        if (routeKey === '$disconnect') {
            // User disconnected - remove from all rooms
            for (const roomId in rooms) {
                const room = rooms[roomId];
                const userIndex = room.users.findIndex(u => u.connectionId === connectionId);
                
                if (userIndex > -1) {
                    // Notify other user if exists
                    const otherUser = room.users.find(u => u.connectionId !== connectionId);
                    
                    if (otherUser) {
                        // In production, you would send a message to the other user
                        console.log(`User ${connectionId} left room ${roomId}, notifying ${otherUser.connectionId}`);
                    }
                    
                    // Remove user
                    room.users.splice(userIndex, 1);
                    
                    // Clean empty room
                    if (room.users.length === 0) {
                        delete rooms[roomId];
                    }
                    
                    break;
                }
            }
            
            cleanupRooms();
            
            return {
                statusCode: 200,
                body: JSON.stringify({ type: 'disconnected' })
            };
        }
        
        if (routeKey === '$default') {
            // Handle regular messages
            try {
                const body = JSON.parse(event.body || '{}');
                const roomId = body.room || 'default';
                const room = rooms[roomId];
                
                if (!room) {
                    return {
                        statusCode: 404,
                        body: JSON.stringify({ 
                            type: 'error',
                            message: 'Room not found' 
                        })
                    };
                }
                
                room.lastActivity = Date.now();
                
                // Handle different message types
                switch (body.type) {
                    case 'join':
                        // User joined - notify other user if exists
                        const otherUser = room.users.find(u => u.connectionId !== connectionId);
                        if (otherUser) {
                            return {
                                statusCode: 200,
                                body: JSON.stringify({
                                    type: 'peer-joined',
                                    room: roomId,
                                    message: 'Peer has joined the room'
                                })
                            };
                        }
                        break;
                        
                    case 'offer':
                    case 'answer':
                    case 'candidate':
                        // Relay WebRTC signaling messages to other user
                        const targetUser = room.users.find(u => u.connectionId !== connectionId);
                        if (targetUser) {
                            return {
                                statusCode: 200,
                                body: JSON.stringify({
                                    ...body,
                                    forwarded: true
                                })
                            };
                        }
                        break;
                        
                    case 'leave':
                        // User is leaving
                        const userIndex = room.users.findIndex(u => u.connectionId === connectionId);
                        if (userIndex > -1) {
                            room.users.splice(userIndex, 1);
                            
                            // Notify other user
                            const remainingUser = room.users[0];
                            if (remainingUser) {
                                return {
                                    statusCode: 200,
                                    body: JSON.stringify({
                                        type: 'peer-left',
                                        room: roomId,
                                        message: 'Peer has left the room'
                                    })
                                };
                            }
                            
                            // Clean empty room
                            if (room.users.length === 0) {
                                delete rooms[roomId];
                            }
                        }
                        break;
                }
                
                return {
                    statusCode: 200,
                    body: JSON.stringify({ 
                        type: 'ack',
                        received: true,
                        timestamp: Date.now()
                    })
                };
                
            } catch (error) {
                console.error('Error processing message:', error);
                return {
                    statusCode: 400,
                    body: JSON.stringify({ 
                        type: 'error',
                        message: 'Invalid message format' 
                    })
                };
            }
        }
    }
    
    // Default response for HTTP requests
    return {
        statusCode: 200,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
            service: 'P2P Chat Signaling Server',
            status: 'operational',
            rooms: Object.keys(rooms).length,
            timestamp: Date.now()
        })
    };
};