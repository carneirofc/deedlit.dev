# Database schema — let the tool manage it

**Goal:** never write `CREATE TABLE` / `ALTER TABLE` by hand again. You change a
Python class, the tool figures out the migration and applies it on startup.

**Stack:** SQLAlchemy 2.0 (models) + Alembic (migrations), auto-applied on boot.
**Applies to:** the Postgres-owning service (`deedlit.catalog`). Neo4j and Qdrant
are not relational — they keep their own APIs, nothing to do here.

---

## The whole idea in three steps

1. **Define tables as Python classes** (SQLAlchemy models). This replaces
   `schema.sql`.
2. **`alembic revision --autogenerate`** looks at your classes vs. the database
   and writes the migration for you. You don't write DDL.
3. **On service startup, `alembic upgrade head` runs automatically** and brings
   the database up to date. This replaces `ensureLibrarySchema()` / `migrate.ts`.

That's it. The only thing you maintain is the Python classes.

---

## One-time setup

```toml
# pyproject.toml — add to the catalog service
dependencies = [
    "sqlalchemy[asyncio]>=2.0.36",
    "alembic>=1.14.0",
    "asyncpg>=0.30.0",       # async driver the app uses
    "psycopg[binary]>=3.2.0" # sync driver Alembic uses
]
```

```python
# db.py — base + engine
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

DATABASE_URL = "postgresql+asyncpg://imageapp:imageapp@localhost:5432/imageapp"

class Base(DeclarativeBase):
    pass

engine = create_async_engine(DATABASE_URL, pool_pre_ping=True)
Session = async_sessionmaker(engine, expire_on_commit=False)
```

Then `alembic init migrations` and point its `migrations/env.py` at your models:

```python
# migrations/env.py — only the two lines that matter
from db import Base
import models            # imports every model so Alembic can see all tables
target_metadata = Base.metadata
# use the sync URL for Alembic:
config.set_main_option("sqlalchemy.url",
    DATABASE_URL.replace("+asyncpg", "+psycopg"))
```

Set `compare_type=True` in `env.py`'s `context.configure(...)` so column-type
changes get detected too.

---

## Auto-apply on startup

```python
# main.py
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from alembic import command
from alembic.config import Config

def _upgrade():
    command.upgrade(Config("alembic.ini"), "head")

@asynccontextmanager
async def lifespan(app: FastAPI):
    await asyncio.to_thread(_upgrade)   # brings DB to latest on every boot; no-op if already current
    yield

app = FastAPI(lifespan=lifespan)
```

> If you ever run more than one instance, guard this with a Postgres advisory
> lock (the same `pg_advisory_xact_lock` trick `migrate.ts` already uses) so two
> boots don't run DDL at once. For a single instance, the above is enough.

---

## Day-to-day: how you evolve the schema

Want a new column or table? **Edit the class, run one command, restart.**

```python
# models.py — e.g. add a column
class Image(Base):
    __tablename__ = "images"
    ...
    notes: Mapped[str | None] = mapped_column(Text)   # <-- new
```

```bash
alembic revision --autogenerate -m "add notes to images"   # tool writes the ALTER
```

Glance at the generated file (autogenerate is a draft — it won't invent data
backfills or CHECK constraints for you), commit it with the model change, and the
next startup applies it. You never type `ALTER TABLE`.

---

## Models = your current schema, in Python

Translate the existing
`deedlit.dev.comfyhelper/lib/library/db/schema.sql` once into model classes
(`images`, `models`, `checkpoints`, `loras`, `image_loras`, `tags`, `image_tags`,
`tag_aliases`, `generation_params`, `image_variants`, `image_descriptions`,
`ingestion_jobs`, `ingestion_job_files`). Example:

```python
from datetime import datetime
from sqlalchemy import Boolean, Integer, Text, text
from sqlalchemy.dialects.postgresql import TIMESTAMP, UUID
from sqlalchemy.orm import Mapped, mapped_column
from db import Base

class Image(Base):
    __tablename__ = "images"
    id: Mapped = mapped_column(UUID(as_uuid=True), primary_key=True,
                               server_default=text("gen_random_uuid()"))
    filename: Mapped[str] = mapped_column(Text, nullable=False)
    sha256_hash: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    favorite: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    imported_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True),
                                                  server_default=text("now()"))
    # ... rest of the columns, one line each
```

From then on the classes are the source of truth and Alembic handles the rest.

---

## Cut-over (so you don't lose existing data)

When the catalog service first connects to the **existing** populated database:
run `alembic stamp head` once — this tells Alembic "the current schema already
matches my first migration," so it won't try to recreate tables. After that,
every future change flows through autogenerate + auto-apply, and you retire
`schema.sql`, `migrate.ts`, and `ensureLibrarySchema()`.

---

## Rules of thumb

- **Never** hand-write DDL in code again — change a model, autogenerate.
- All queries go through SQLAlchemy (`select(...)`, `session.get(...)`); raw SQL
  only for the odd CTE/window query, always with bound parameters.
- Commit the model change and its generated migration together.
