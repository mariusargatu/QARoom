------------------------------ MODULE Rollout ------------------------------
(***************************************************************************)
(* A TLA+ model of one feature-flag's donation-rollout lifecycle (QARoom  *)
(* Milestone 5; verifiable-invariants experiment, ADR-0024 Phase 3; T19). *)
(*                                                                         *)
(* The committed-state twin of the hand-authored XState machine           *)
(* (packages/contracts/src/machines/rollout.machine.ts), driven by        *)
(* applyRolloutEvent (rollout.runner.ts) and persisted by                 *)
(* services/flags/src/repository.ts#advanceRollout. The flag's value per   *)
(* community IS the current state of this machine; events advance it:      *)
(*                                                                         *)
(*   Off       --EnableRequested-->  Enabling                              *)
(*   Enabling  --CanaryConfirmed-->  Canary                               *)
(*   Enabling  --RolloutAborted-->   Off       (bail out before canary)    *)
(*   Canary    --RolloutCompleted--> Enabled    (settled / globally ON)    *)
(*   Canary    --RolloutAborted-->   Off       (bail out before enable)    *)
(*   Enabled   --DisableRequested--> Disabling                            *)
(*   Disabling --DisableCompleted--> Off                                  *)
(*                                                                         *)
(* Unlike WebhookDelivery, the rollout machine is DELIBERATELY NON-        *)
(* TERMINATING: Enabled is a settled gate, not a final state, and the      *)
(* reverse path returns it to Off. So the liveness property here is not    *)
(* "eventually terminal" but "always eventually SETTLES" — a rollout in    *)
(* flight (Enabling / Canary / Disabling) is never permanently stuck.      *)
(*                                                                         *)
(* The same legal-edge relation is enforced AT THE REAL BOUNDARY by        *)
(* services/flags/src/rollout-invariant.ts (assertLegalRolloutTransition), *)
(* a tested projection of this Next relation derived from the machine.     *)
(* See spec/tla/README.md.                                                 *)
(***************************************************************************)
EXTENDS Naturals

VARIABLES
    status,                 \* the committed flags.state for one (community, flag)
    canaryThisCycle         \* ghost: has the current enable-cycle passed through Canary?

vars == <<status, canaryThisCycle>>

Settled  == {"Off", "Enabled"}
States   == {"Off", "Enabling", "Canary", "Enabled", "Disabling"}

TypeOK ==
    /\ status \in States
    /\ canaryThisCycle \in BOOLEAN

Init ==
    /\ status = "Off"
    /\ canaryThisCycle = FALSE

(* One legal committed transition. Each disjunct is exactly one machine edge; the ghost      *)
(* canaryThisCycle is set on entering Canary and reset on returning to Off (a fresh cycle),  *)
(* so EnabledImpliesCanary can prove the canary phase is never skipped on the way to Enabled. *)
EnableRequested ==
    /\ status = "Off"
    /\ status' = "Enabling"
    /\ UNCHANGED canaryThisCycle

CanaryConfirmed ==
    /\ status = "Enabling"
    /\ status' = "Canary"
    /\ canaryThisCycle' = TRUE

RolloutCompleted ==
    /\ status = "Canary"
    /\ status' = "Enabled"
    /\ UNCHANGED canaryThisCycle

RolloutAborted ==
    /\ status \in {"Enabling", "Canary"}
    /\ status' = "Off"
    /\ canaryThisCycle' = FALSE

DisableRequested ==
    /\ status = "Enabled"
    /\ status' = "Disabling"
    /\ UNCHANGED canaryThisCycle

DisableCompleted ==
    /\ status = "Disabling"
    /\ status' = "Off"
    /\ canaryThisCycle' = FALSE

(***************************************************************************)
(* SPEC-LEVEL FALSIFIER (mirrors the FLAGS_BUG_CANARY_MISROUTES toggle).    *)
(* Uncomment MisrouteCanary and add it to Next: it routes Enabling DIRECTLY *)
(* to Enabled, skipping the Canary cohort phase, so TLC finds a trace       *)
(* violating EnabledImpliesCanary — the model-level twin of the transfer-   *)
(* fault the stateful-PBT demo catches in code (services/flags, docs/07).   *)
(* assertLegalRolloutTransition rejects the same Enabling->Enabled edge.    *)
(***************************************************************************)
\* MisrouteCanary ==
\*     /\ status = "Enabling"
\*     /\ status' = "Enabled"
\*     /\ UNCHANGED canaryThisCycle

Next ==
    \/ EnableRequested
    \/ CanaryConfirmed
    \/ RolloutCompleted
    \/ RolloutAborted
    \/ DisableRequested
    \/ DisableCompleted
\*     \/ MisrouteCanary   \* <- the falsifier variant

Spec == Init /\ [][Next]_vars /\ WF_vars(Next)

----------------------------------------------------------------------------
(* INVARIANTS *)

\* The canary gate is never skipped: a flag is globally Enabled only after its current
\* enable-cycle passed through the Canary cohort phase (the type system cannot say this).
EnabledImpliesCanary == (status = "Enabled") => canaryThisCycle

(* TEMPORAL *)

\* Non-starvation: a rollout in flight is never permanently stuck — the machine always
\* eventually returns to a settled state (Off or Enabled). Under weak fairness, the transient
\* states Enabling / Canary / Disabling always make progress; none has a self-loop, and every
\* cycle in the graph returns to Off, so a settled state is reached infinitely often.
EventuallySettles == []<>(status \in Settled)

=============================================================================
