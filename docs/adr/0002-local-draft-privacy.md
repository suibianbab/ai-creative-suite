# ADR 0002: Shared-browser local draft privacy

Status: proposed, 2026-10-10. Product choice between cloud-first and encrypted offline persistence is pending.

## Problem

Image Studio's version 1 IndexedDB stores ImageDocument records and original image blobs in plaintext. Its storage is scoped to the browser origin and profile, not to a Keycloak account. A second account in the same profile can list and open an earlier account's local project. `UI-004` reproduces this with two real development users. Cloud API membership checks do not change that local boundary.

Account tags, filtered lists, or a different object-store name would only hide entries in the application UI. They would leave the original bytes available to any script running on the origin in that browser profile. We will not count such a change as passing `UI-004`.

## Option A: Cloud-first persistent drafts

Persist authenticated drafts and originals only through the workspace API. Keep unsaved editing in memory for the current tab. The cloud API remains the account and tenant boundary. This minimizes local key management and gives the user one persistent project model, but requires a network connection to save or reopen.

Existing plaintext drafts cannot be attributed to their original user by the current schema. Migration must be an explicit action by the person using the old browser profile: show the legacy draft, import it into a selected authorized workspace, verify the imported project and original bytes, then remove the corresponding local records. A failed or interrupted import must leave the local copy intact. Do not autoassign legacy projects to whichever account logs in first. Until migrated, the legacy store remains a shared-profile exposure; shared-device use cannot be declared safe.

## Option B: Encrypted offline drafts

Encrypt documents and original blobs before IndexedDB writes with a user-supplied secret that is not stored in browser storage. A separate per-user vault key must be derived with a reviewed KDF and distinct salt; authenticated user ID alone is not a secret. Keep the unlocked key only in memory and clear it on logout, account switch, and tab close. Explicitly recover or migrate plaintext version 1 drafts without silently claiming an owner. Test wrong-secret, second-account, restart, corruption, interrupted migration, and large-file cases. This preserves offline persistence at the cost of a recovery and key-management UX.

## Immediate containment

Clearing the cloud session also clears the current canvas, image bitmaps, and in-memory original-file map. This prevents the prior cloud project from staying visible in the same tab after the session is cleared. It does not protect version 1 IndexedDB; `UI-004` remains failed.

## Acceptance gate

Choose one product option, implement its migration path, and verify that a second account in the same browser profile cannot read the first account's persistent draft or original bytes. Preserve existing drafts until their authorized migration is verified. An independent fresh-context security review is required because this crosses the authentication and tenant boundary.
