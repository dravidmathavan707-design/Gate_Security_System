import asyncio
from collections import defaultdict

from fastapi import WebSocket


class RealtimeManager:
    def __init__(self) -> None:
        self._connections: dict[int, set[WebSocket]] = defaultdict(set)

    async def connect(self, user_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections[user_id].add(websocket)

    def disconnect(self, user_id: int, websocket: WebSocket) -> None:
        connections = self._connections.get(user_id)
        if connections is None:
            return
        connections.discard(websocket)
        if not connections:
            self._connections.pop(user_id, None)

    async def publish(self, user_id: int, event: dict[str, object]) -> bool:
        connections = tuple(self._connections.get(user_id, ()))
        if not connections:
            return False

        results = await asyncio.gather(
            *(websocket.send_json(event) for websocket in connections),
            return_exceptions=True,
        )
        for websocket, result in zip(connections, results):
            if isinstance(result, Exception):
                self.disconnect(user_id, websocket)
        return any(not isinstance(result, Exception) for result in results)


realtime_manager = RealtimeManager()
