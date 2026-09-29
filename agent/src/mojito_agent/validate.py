from datetime import datetime


class ValidationError(Exception):
    pass


def require_fields(obj: dict, fields: tuple[str, ...], where: str) -> None:
    missing = [f for f in fields if f not in obj]
    if missing:
        raise ValidationError(f"{where}: missing fields {missing} in {obj}")


def require_nonempty_str(obj: dict, field: str, where: str) -> None:
    value = obj[field]
    if not isinstance(value, str) or not value.strip():
        raise ValidationError(f"{where}: {field} must be a non-empty string, got {value!r}")


def require_enum(obj: dict, field: str, allowed: tuple[str, ...], where: str) -> None:
    if obj[field] not in allowed:
        raise ValidationError(f"{where}: {field}={obj[field]!r} not in {allowed}")


def require_aware_datetime_or_null(obj: dict, field: str, where: str) -> None:
    value = obj[field]
    if value is None:
        return
    try:
        parsed = datetime.fromisoformat(value)
    except (TypeError, ValueError) as e:
        raise ValidationError(f"{where}: {field}={value!r} is not ISO-8601") from e
    if parsed.tzinfo is None:
        raise ValidationError(f"{where}: {field}={value!r} has no timezone")
