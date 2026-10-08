import os
import sys
import time
import uuid
import signal
import asyncio
import subprocess
from collections import deque
from typing import Dict, List, Optional, Set
from fastapi import WebSocket

class TerminalSession:
    def __init__(
        self,
        session_id: str,
        owner_user_id: str,
        server_name: str,
        ip: str,
        user: str,
        working_directory: str = "/home/ubuntu",
        history_limit: int = 1000
    ):
        self.session_id: str = session_id
        self.owner_user_id: str = owner_user_id
        self.server_name: str = server_name
        self.ip: str = ip
        self.user: str = user
        self.working_directory: str = working_directory
        self.status: str = "active"
        self.created_at: float = time.time()
        self.last_activity_at: float = time.time()
        
        # In-memory temporary ring buffer — never persisted to DB/disk
        self.history_buffer: deque = deque(maxlen=history_limit)
        self.ws_clients: Set[WebSocket] = set()
        
        # OS Process / Shell handler
        self.process: Optional[subprocess.Popen] = None
        self.master_fd: Optional[int] = None
        self.cols: int = 80
        self.rows: int = 24

    def touch(self):
        """Update last activity timestamp to prevent idle timeout."""
        self.last_activity_at = time.time()

    def append_history(self, data: str):
        self.history_buffer.append(data)
        self.touch()

    def get_history(self) -> str:
        return "".join(self.history_buffer)

    def to_dict(self) -> dict:
        return {
            "session_id": self.session_id,
            "owner_user_id": self.owner_user_id,
            "server_name": self.server_name,
            "ip": self.ip,
            "user": self.user,
            "status": self.status,
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(self.created_at)),
            "last_activity_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(self.last_activity_at)),
            "working_directory": self.working_directory
        }


class SessionManager:
    def __init__(self, max_sessions_per_user: int = 5, idle_timeout_seconds: int = 900):
        self.max_sessions_per_user = max_sessions_per_user
        self.idle_timeout_seconds = idle_timeout_seconds
        self.sessions: Dict[str, TerminalSession] = {}

    def create_session(
        self,
        owner_user_id: str,
        server_name: str = "Linux Server",
        ip: str = "127.0.0.1",
        user: str = "ubuntu",
        working_directory: str = "/home/ubuntu"
    ) -> TerminalSession:
        # Enforce quota per user
        user_active = [
            s for s in self.sessions.values()
            if s.owner_user_id == owner_user_id and s.status != "terminated"
        ]
        if len(user_active) >= self.max_sessions_per_user:
            raise ValueError(f"Session limit exceeded (max {self.max_sessions_per_user} per user)")

        # Generate cryptographic unpredictable UUIDv4
        session_id = uuid.uuid4().hex

        session = TerminalSession(
            session_id=session_id,
            owner_user_id=owner_user_id,
            server_name=server_name,
            ip=ip,
            user=user,
            working_directory=working_directory
        )

        # Spawn independent shell process group
        self._spawn_pty_or_shell(session)

        self.sessions[session_id] = session
        return session

    def _spawn_pty_or_shell(self, session: TerminalSession):
        """Spawns an independent PTY process tree isolated from other sessions."""
        # Linux / Unix PTY
        if hasattr(os, "openpty"):
            try:
                import pty
                master_fd, slave_fd = pty.openpty()
                session.master_fd = master_fd
                
                # Start subshell in slave PTY
                cmd = ["/bin/bash", "-l"] if os.path.exists("/bin/bash") else ["/bin/sh"]
                proc = subprocess.Popen(
                    cmd,
                    stdin=slave_fd,
                    stdout=slave_fd,
                    stderr=slave_fd,
                    preexec_fn=os.setsid,  # Detach process group
                    close_fds=True,
                    cwd=session.working_directory if os.path.isdir(session.working_directory) else None
                )
                os.close(slave_fd)
                session.process = proc
                return
            except Exception as e:
                pass

        # Windows / Subprocess fallback
        shell_cmd = ["cmd.exe"] if sys.platform == "win32" else ["/bin/sh"]
        proc = subprocess.Popen(
            shell_cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=0
        )
        session.process = proc

    def list_sessions(self, owner_user_id: str) -> List[dict]:
        """Returns ONLY sessions belonging to the authenticated user."""
        return [
            s.to_dict() for s in self.sessions.values()
            if s.owner_user_id == owner_user_id and s.status != "terminated"
        ]

    def get_session(self, session_id: str, owner_user_id: str) -> TerminalSession:
        """Enforces Layer 2 Session Authorization: checks ownership server-side."""
        session = self.sessions.get(session_id)
        if not session or session.status == "terminated":
            raise KeyError("Session not found or terminated")
        if session.owner_user_id != owner_user_id:
            raise PermissionError("Access denied: Not the session owner")
        return session

    def terminate_session(self, session_id: str, owner_user_id: str) -> dict:
        """Terminates PTY, kills child processes, wipes in-memory buffer."""
        session = self.get_session(session_id, owner_user_id)
        
        session.status = "terminated"
        
        # Kill process group
        if session.process:
            try:
                if hasattr(os, "killpg") and hasattr(session.process, "pid"):
                    os.killpg(os.getpgid(session.process.pid), signal.SIGTERM)
                else:
                    session.process.terminate()
            except Exception:
                pass

        # Close file descriptor
        if session.master_fd is not None:
            try:
                os.close(session.master_fd)
            except Exception:
                pass
            session.master_fd = None

        # Wipe temporary history buffer from memory
        session.history_buffer.clear()

        # Remove from active map
        self.sessions.pop(session_id, None)

        return {"session_id": session_id, "status": "terminated"}

    def check_idle_timeouts(self) -> List[TerminalSession]:
        """Scans for inactive sessions and terminates them automatically."""
        now = time.time()
        timed_out = []
        for sid, session in list(self.sessions.items()):
            if session.status == "active" and (now - session.last_activity_at) >= self.idle_timeout_seconds:
                timed_out.append(session)
                self.terminate_session(sid, session.owner_user_id)
        return timed_out


# Singleton Session Manager instance
manager = SessionManager(max_sessions_per_user=5, idle_timeout_seconds=900)
