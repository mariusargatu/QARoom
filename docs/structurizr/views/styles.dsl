# Element + relationship styles, by tag. Self-contained (no external theme fetch) so the workspace
# renders identically offline. Tags are set in the model files; add a style here when you add a tag.

styles {
    element "Element" {
        color #ffffff
    }
    element "Person" {
        shape Person
        background #08427b
    }
    element "External" {
        background #8a8a8a
    }
    element "Container" {
        background #1168bd
    }
    element "Database" {
        shape Cylinder
        background #2f5d8c
    }
    element "Broker" {
        shape Pipe
        background #5d3c8c
    }
    element "Component" {
        background #438dd5
    }
    element "Infrastructure Node" {
        background #51606e
    }
    element "Infra" {
        background #51606e
    }

    # ---- testing-architecture element styles ----
    element "Boundary" {
        shape RoundedBox
        background #b45309
    }
    element "Technique" {
        background #0f766e
    }
    element "Claim" {
        shape RoundedBox
        background #7c3aed
    }
    element "Source" {
        shape Hexagon
        background #15803d
    }
    element "Artifact" {
        shape Folder
        background #1d4ed8
    }
    element "Gate" {
        shape RoundedBox
        background #b91c1c
    }

    # ---- relationship styles ----
    relationship "Relationship" {
        color #707070
        thickness 2
    }
    relationship "Async" {
        dashed true
        color #5d3c8c
    }
    relationship "Sync" {
        dashed false
    }
}
