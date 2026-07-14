# Review

## Findings

1. High: the container entrypoint cannot start because it targets `app.main:app`, but there is no `backend/app/main.py` in the tree.
   - `Dockerfile` ends with `CMD ["uvicorn", "app.main:app", ...]` at [Dockerfile](/mnt/c/Users/aliab/Desktop/Education/Programming/EdDonnerAgenticAI/finally/Dockerfile#L75).
   - The backend source copied into the image only includes `backend/app/` and `backend/schema/`; `backend/app/main.py` does not exist in the repository.
   - Result: `uvicorn` will fail with an import error, so the image never reaches the healthcheck.

2. High: the SQLite path logic does not match the container layout, so the app will not use the bind-mounted database directory.
   - `backend/schema/database.py` derives `DEFAULT_DB_PATH` from `Path(__file__).resolve().parents[2]` and only honors the `DB_PATH` environment variable at [backend/schema/database.py](/mnt/c/Users/aliab/Desktop/Education/Programming/EdDonnerAgenticAI/finally/backend/schema/database.py#L25-L54).
   - `Dockerfile` copies the package to `/app/schema` and sets `FINALLY_DB_PATH=/app/db/finally.db`, not `DB_PATH`, at [Dockerfile](/mnt/c/Users/aliab/Desktop/Education/Programming/EdDonnerAgenticAI/finally/Dockerfile#L43-L46) and [Dockerfile](/mnt/c/Users/aliab/Desktop/Education/Programming/EdDonnerAgenticAI/finally/Dockerfile#L58-L59).
   - Inside the container, `parents[2]` for `/app/schema/database.py` resolves to `/`, so the fallback DB path becomes `/db/finally.db`, bypassing the mounted `/app/db` volume. That means data will not persist where the scripts and compose setup expect it.

## Open Questions

- None.
