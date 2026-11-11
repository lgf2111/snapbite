-- Remember how a session was opened ('google' or 'email') so Settings can say
-- "Signed in with Google". Existing rows stay NULL: they were opened before we
-- recorded it, and the app simply shows "Signed in".
ALTER TABLE `sessions` ADD `method` text;
