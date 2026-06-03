from fastapi import HTTPException, status


class AppError(HTTPException):
    def __init__(self, code: str, message: str, status_code: int = 400, details: dict = None):
        self.error_code = code
        self.error_message = message
        super().__init__(
            status_code=status_code,
            detail={"success": False, "error": {"code": code, "message": message, "details": details or {}}},
        )


# Auth errors
class AuthTokenExpired(AppError):
    def __init__(self):
        super().__init__("AUTH_TOKEN_EXPIRED", "Token已过期", status.HTTP_401_UNAUTHORIZED)


class AuthTokenInvalid(AppError):
    def __init__(self):
        super().__init__("AUTH_TOKEN_INVALID", "Token无效", status.HTTP_401_UNAUTHORIZED)


class AuthRefreshFailed(AppError):
    def __init__(self):
        super().__init__("AUTH_REFRESH_FAILED", "Token刷新失败", status.HTTP_401_UNAUTHORIZED)


class AuthAccountLocked(AppError):
    def __init__(self):
        super().__init__("AUTH_ACCOUNT_LOCKED", "账号已锁定", 423)


class PasswordMismatch(AppError):
    def __init__(self):
        super().__init__("AUTH_PASSWORD_MISMATCH", "旧密码错误", status.HTTP_400_BAD_REQUEST)


class PasswordSameAsOld(AppError):
    def __init__(self):
        super().__init__("AUTH_PASSWORD_SAME", "新密码不能与旧密码相同", status.HTTP_400_BAD_REQUEST)


# Common errors
class NotFoundError(AppError):
    def __init__(self, resource: str = "资源"):
        super().__init__("COMMON_NOT_FOUND", f"{resource}不存在", status.HTTP_404_NOT_FOUND)


class ForbiddenError(AppError):
    def __init__(self, message: str = "无权限"):
        super().__init__("COMMON_FORBIDDEN", message, status.HTTP_403_FORBIDDEN)


class ValidationError(AppError):
    def __init__(self, message: str = "参数验证失败"):
        super().__init__("COMMON_VALIDATION", message, status.HTTP_400_BAD_REQUEST)


# Message errors
class ConversationNotFound(AppError):
    def __init__(self):
        super().__init__("MSG_CONVERSATION_NOT_FOUND", "会话不存在", status.HTTP_404_NOT_FOUND)


class NotConversationMember(AppError):
    def __init__(self):
        super().__init__("MSG_PARTICIPANT_NOT_MEMBER", "非会话参与者", status.HTTP_403_FORBIDDEN)


class ContentTooLarge(AppError):
    def __init__(self):
        super().__init__("MSG_CONTENT_TOO_LARGE", "消息内容过大", status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)


# Agent errors
class AgentNotFound(AppError):
    def __init__(self):
        super().__init__("AGT_NOT_FOUND", "Agent不存在", status.HTTP_404_NOT_FOUND)


class AgentNotOwner(AppError):
    def __init__(self):
        super().__init__("AGT_NOT_OWNER", "非Agent所有者", status.HTTP_403_FORBIDDEN)


# Task errors
class TaskNotFound(AppError):
    def __init__(self):
        super().__init__("TASK_NOT_FOUND", "任务不存在", status.HTTP_404_NOT_FOUND)


# File errors
class FileTooLarge(AppError):
    def __init__(self):
        super().__init__("FILE_TOO_LARGE", "文件过大（>100MB）", status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)


class FileNotFound(AppError):
    def __init__(self):
        super().__init__("FILE_NOT_FOUND", "文件不存在", status.HTTP_404_NOT_FOUND)
