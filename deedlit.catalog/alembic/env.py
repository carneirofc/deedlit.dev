"""Alembic environment for the deedlit.catalog service.

The catalog service owns this migration tree. Migrations are written as raw SQL
(op.execute) rather than against SQLAlchemy ORM metadata, so there is no
target_metadata / autogenerate here — the schema is hand-authored and ported
from the comfyhelper canonical schema.

The database URL is resolved as follows:
  * the ``CATALOG_DATABASE_URL`` environment variable, when set, wins (this is
    how the service points migrations at its DB in deployment);
  * otherwise the ``sqlalchemy.url`` main option is used — set programmatically
    by tests, or falling back to the alembic.ini local-dev default.
"""
from __future__ import annotations

import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)


def _database_url() -> str:
    return os.environ.get("CATALOG_DATABASE_URL") or config.get_main_option(
        "sqlalchemy.url"
    )


def run_migrations_offline() -> None:
    context.configure(
        url=_database_url(),
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    section = config.get_section(config.config_ini_section, {})
    section["sqlalchemy.url"] = _database_url()
    connectable = engine_from_config(
        section,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=None)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
