-- 015_user_code.sql — Add 4-digit numeric user ID
-- Idempotent: safe to run multiple times

-- 1. Add column (nullable first for backfill)
ALTER TABLE users ADD COLUMN IF NOT EXISTS user_code VARCHAR(4);

-- 2. Backfill existing users with random non-reserved codes
DO $$
DECLARE
    r RECORD;
    available INT[];
    idx INT;
    code_str VARCHAR(4);
    taken INT[];
    i INT;
    n INT;
    is_reserved BOOLEAN;
BEGIN
    -- Skip if all users already have codes
    IF NOT EXISTS (SELECT 1 FROM users WHERE user_code IS NULL) THEN
        RETURN;
    END IF;

    -- Collect already-taken codes as integers
    SELECT array_agg(user_code::int)
      INTO taken
      FROM users
     WHERE user_code IS NOT NULL;
    IF taken IS NULL THEN taken := ARRAY[]::INT[]; END IF;

    -- Build available pool: 1000-9999 minus reserved minus taken
    available := ARRAY[]::INT[];
    FOR i IN 1000..9999 LOOP
        is_reserved := false;

        -- Repeating (豹子号): 1111,2222,...,9999
        IF i % 1111 = 0 AND i >= 1111 THEN
            is_reserved := true;
        END IF;

        -- Sequential ascending: 1234,2345,3456,4567,5678,6789
        IF i IN (1234,2345,3456,4567,5678,6789) THEN
            is_reserved := true;
        END IF;

        -- Sequential descending: 9876,8765,7654,6543,5432,4321
        IF i IN (9876,8765,7654,6543,5432,4321) THEN
            is_reserved := true;
        END IF;

        -- Skip if already taken
        IF i = ANY(taken) THEN
            is_reserved := true;
        END IF;

        IF NOT is_reserved THEN
            available := array_append(available, i);
        END IF;
    END LOOP;

    -- Shuffle available pool (Fisher-Yates)
    n := array_length(available, 1);
    FOR i IN REVERSE n..2 LOOP
        idx := floor(random() * i + 1)::int;
        -- swap using code_str as temp
        code_str := available[i]::text;
        available[i] := available[idx];
        available[idx] := code_str::int;
    END LOOP;

    -- Assign to users without codes
    idx := 1;
    FOR r IN SELECT id FROM users WHERE user_code IS NULL ORDER BY created_at LOOP
        IF idx > n THEN
            RAISE EXCEPTION 'Not enough available user codes for existing users';
        END IF;
        code_str := lpad(available[idx]::text, 4, '0');
        UPDATE users SET user_code = code_str WHERE id = r.id;
        idx := idx + 1;
    END LOOP;
END $$;

-- 3. Add constraints
DO $$
BEGIN
    ALTER TABLE users ALTER COLUMN user_code SET NOT NULL;
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE users ADD CONSTRAINT users_user_code_key UNIQUE (user_code);
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_user_code ON users(user_code);
