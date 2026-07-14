# 0008. Separate Android production and beta release identities

- Status: accepted

## Context

Android identifies an installed application by its application ID and accepts an update only when the signing identity is compatible. Syncer Beta must be installable alongside the production application without sharing data, and compromise of Beta signing material must not compromise production releases.

## Decision

- Production releases use application ID `com.wbbb.syncer` and a dedicated Production Key.
- Beta releases use application ID `com.wbbb.syncer.beta` and a dedicated Beta Key.
- Both channels produce self-contained release APKs. GitHub Actions selects the application ID and signing secrets from the release tag; Beta remains a GitHub Prerelease.
- Signing keys belong to the project rather than an individual developer. Each key has an encrypted offline backup independent of GitHub Actions secrets.

## Consequences

- Production and Beta can be installed concurrently and maintain separate application data.
- An APK from one channel cannot update an installation from the other channel.
- Changing from the former `com.syncer` application ID creates a new Android application identity; existing `com.syncer` installations cannot update in place.
- Release operations must maintain two signing keys and two sets of GitHub Actions secrets.
