workspace "QARoom" "Multi-tenant social platform built to demonstrate testing-driven architecture. The C4 model AND the testing architecture as code, grounded in services/* and the manifests under scripts/lib/manifests/. Read docs/02-architecture.md + docs/03-testing-strategy.md." {

    !identifiers hierarchical

    # The model is split into focused, single-responsibility files so the architecture stays diffable
    # and maintainable: a PR that moves a service boundary changes one file, in the same commit.
    # See README.md ("How this is organized" + "How to maintain") for the editing map.
    model {
        # personas + external software systems
        !include model/people.dsl
        # the QARoom system: containers + components + testing perspectives
        !include model/platform.dsl
        # every structural edge (context + container + component)
        !include model/relationships.dsl
        # the testing architecture: boundaries, techniques, claims, gates
        !include model/testing.dsl
        # the k3d (local) deployment topology
        !include model/deployment.dsl
    }

    views {
        # C4: context, containers, components, dynamics, deployment
        !include views/structural.dsl
        # custom views: boundary map, honeycomb tiers, claims, triangulation
        !include views/testing-views.dsl
        # element + relationship styles (self-contained, offline)
        !include views/styles.dsl
    }

    # Embedded documentation (the two model-local guides) + the canonical ADRs rendered read-only.
    # Both resolve because the site is built (and Lite is run) from a repo-root mount: `!adrs ../adr`
    # → docs/adr. The ADRs stay single-sourced in docs/adr; this only renders them, never edits them.
    !docs docs
    !adrs ../adr
}
