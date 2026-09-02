"""
One-off migration: adds user profile and AI career profile fields to the users table.

Columns added:
- phone
- location
- headline
- current_status
- target_role
- years_of_experience
- career_goal
- preferred_location

Usage: python migrate_user_profile.py
Safe to run multiple times - checks existing columns before altering table.
"""
import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "instance", "resume_builder.sqlite")


def column_exists(cur, table, column):
    cur.execute(f"PRAGMA table_info({table})")
    return any(row[1] == column for row in cur.fetchall())


def main():
    if not os.path.exists(DB_PATH):
        print(f"No existing database at {DB_PATH} - nothing to migrate. "
              "It will be created fresh with the correct schema on next run.")
        return

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    columns_to_add = [
        ("phone", "VARCHAR(30)"),
        ("location", "VARCHAR(120)"),
        ("headline", "VARCHAR(150)"),
        ("current_status", "VARCHAR(50)"),
        ("target_role", "VARCHAR(150)"),
        ("years_of_experience", "VARCHAR(30)"),
        ("career_goal", "TEXT"),
        ("preferred_location", "VARCHAR(120)"),
    ]

    migrated_any = False
    for col_name, col_type in columns_to_add:
        if not column_exists(cur, "users", col_name):
            print(f"Adding column '{col_name}' to users table...")
            cur.execute(f"ALTER TABLE users ADD COLUMN {col_name} {col_type}")
            migrated_any = True

    if migrated_any:
        conn.commit()
        print("User profile migration complete.")
    else:
        print("User profile migration already applied - nothing to do.")

    conn.close()


if __name__ == "__main__":
    main()
