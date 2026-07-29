import socket
import uvicorn


def free_port() -> int:
    s = socket.socket()
    s.bind(("", 0))
    s.listen(1)
    return s.getsockname()[1]


def serve(starlette_app, port: int) -> None:
    uvicorn.run(starlette_app, host="127.0.0.1", port=port, log_level="warning")
