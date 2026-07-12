# Review of `planning/PLAN.md`

Overall, the plan is strong and the product direction is coherent. The main issues are a couple of spec inconsistencies that will create avoidable implementation drift unless they are resolved up front.

## Findings

1. **`users_profile` contradicts the global `user_id` rule**  
   In §7, the plan says: "All tables include a `user_id` column defaulting to `default`." But `users_profile` is defined with `id` as the primary key and does not include `user_id` at all. That leaves the schema contract ambiguous for the one table that represents the canonical user record.  
   Fix by either adding `user_id` to `users_profile` or rewriting the rule so `users_profile.id` is the user identifier and the exception is explicit.

2. **The SQLite storage model is internally inconsistent**  
   §4 says `db/` is the runtime volume mount point and that `db/finally.db` persists there. §11 then shows a named volume mount (`finally-data:/app/db`) and still says the project-root `db/` directory maps to `/app/db`. Those are different deployment models.  
   This matters because the implementation of the Dockerfile, start scripts, and persistence behavior will diverge depending on whether the team uses a bind mount or a named volume. Pick one approach and align all references. If the repo should own the mount target, `./db:/app/db` is the consistent choice. If the deployment should use a named volume, remove the claim that the project-root `db/` directory maps to the container path.

3. **SSE cadence is underspecified relative to market-data polling**  
   §6 says the SSE server pushes updates at roughly 500ms cadence, while the Massive API path in the same section polls only every 2-15 seconds and the default free tier every 15 seconds. That can work only if the SSE layer is explicitly republishing cached values or emitting only on cache changes.  
   Clarify this now, otherwise the frontend team may build against the assumption that it will receive fresh price deltas every 500ms even when the real-data backend can only refresh far less frequently.

## Recommendation

Resolve the schema and storage-path contradictions before implementation starts. After that, the remaining plan reads as a solid build spec with a clear product target.
