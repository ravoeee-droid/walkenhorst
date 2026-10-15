CREATE INDEX wh_login_window ON wh_login_limits(window_start);
CREATE INDEX wh_session_refresh_expiry ON wh_sessions(refresh_expires_at);
