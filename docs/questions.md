# Twenty questions a pump endurance specification does not answer

Every specification we have been sent for a test system has been clear about what to measure and
quiet about what to do. These are the questions we end up asking anyway — usually halfway through
the build, when the answer is expensive.

They are worth reading even if you never talk to us. Most of them change the design.

---

## Data and what survives

**1. What sample rate does the rig acquire at, and what rate does it record at?**
Those are two different decisions and specifications usually give one number. A 2 000-hour run
recorded at 1 kHz on twenty channels is hundreds of gigabytes; at 1 Hz it is a couple. The usual
answer is to sample fast, log slow, keep min/max/RMS per logged interval so a transient still leaves
a trace, and capture a burst at full rate around anything interesting.
*Changes: storage sizing, controller choice, whether a transient is recoverable at all.*

**2. Is case drain flow judged against a limit, or against its own trend?**
On a piston pump it is the wear indicator — it climbs as internal clearances open up. A single
reading tells you little; the slope over 2 000 hours tells you everything. If the acceptance
criterion is a rate of change, the system has to compute and store it, not just alarm on it.
*Changes: whether trend analysis is a feature or an afterthought.*

**3. What happens to the data when the network share is unavailable mid-run?**
Shares go down. If the controller writes straight to it, a night's data is gone. If it buffers
locally and back-fills, how much buffer is enough, and what warns someone that it is filling?
*Changes: controller storage sizing, and whether a long run can survive IT maintenance.*

**4. How long is run data kept, and who is allowed to delete it?**
Rarely specified, always assumed. It decides whether you need a retention policy in the software or
a person with a script.
*Changes: storage architecture, and whether anyone can quietly destroy evidence.*

**5. What format does the data have to be readable in, by whom, in five years?**
A format that needs a vendor's runtime to open is a liability. So is one that needs the original
engineer to explain the column names.
*Changes: file format, and how much metadata travels with the samples.*

## What a procedure actually means

**6. When does a dwell start — at step entry, or when the condition is reached?**
"Hold at 55 °C for three hours" means one thing if the clock starts on entry and another if it
starts when the oil is actually at 55 °C. On a long endurance procedure the difference accumulates
into days.
*Changes: what the stated test duration means. This is the single most consequential question here.*

**7. What should a conditional step do when it times out?**
"Run until oil reaches 55 °C" needs an answer for the morning it does not. Abort to shutdown, hold
and call someone, or carry on regardless — each is right in some cases and dangerous in others.
*Changes: whether a fill step that never achieves flow can proceed into a 2 000-hour run.*

**8. Is a cycle counter first-class?**
Durability specifications are often written in cycles as well as hours. If cycles matter, the count
must be persistent, displayed, logged and recoverable after a power loss — which is real design
weight, not a label on a screen.
*Changes: state persistence, and what happens after an unplanned restart.*

**9. Are there planned interventions during a long run?**
2 000 hours is twelve weeks. Oil sampling, filter changes, inspection, re-torque — if any of these
happen mid-run, the sequencer needs to pause and resume cleanly, and the data needs to record the
gap rather than pretend it did not happen.
*Changes: whether the procedure model needs a hold-and-resume concept at all.*

**10. Are there rate limits on the way into a condition?**
A maximum acceleration for the drive, a maximum pressure ramp for the circuit, a thermal shock limit
for the pump. A procedure that only specifies target and duration cannot express these.
*Changes: whether steps need a rate as well as a setpoint.*

**11. How does a procedure move between machines?**
Written on one stand, run on another. That works only if channel names mean the same thing
everywhere and the software refuses a procedure that names something the target stand does not have.
*Changes: configuration model, and whether "copy it to the other stand" is a USB stick or a feature.*

## Limits, alarms and what stops the machine

**12. Which alarms may be switched off for a step, and by whom?**
Some must be: system pressure is legitimately zero during fill, so an armed low-pressure alarm would
trip every start-up. Some must never be — the ones that protect the machine. Who decides, and is the
change recorded?
*Changes: the permission model, and whether an operator can quietly disarm the protection.*

**13. Is there an upper software limit on system pressure, or is relief purely mechanical?**
Both answers are defensible. Mechanical relief is the real protection and software should not
pretend otherwise. But if there is no software limit at all, that should be a decision someone made,
not a gap nobody noticed.
*Changes: the threshold model, and what the operator sees during an overpressure test.*

**14. On a red alarm, should the stand stop or unload first?**
Dropping the drive instantly is not always the safest thing for a hydraulic circuit. Opening the
load valve and then stopping may be. The right order is yours to specify; the software should not
invent it.
*Changes: the shutdown sequence, and possibly the mechanical design.*

**15. Do alarms need a deadband or an on-delay?**
A channel sitting exactly on a limit will raise and clear the same alarm repeatedly, and a duty
cycle that crosses a limit twice a minute will fill the log with noise nobody reads.
*Changes: alarm handling, and whether the log is usable after a long run.*

## Safety, and who is allowed to do what

**16. What is the boundary between the safety system and the software?**
Our position: functional safety belongs in hardware — a safety relay and an emergency stop. Software
does process protection and orderly shutdown. If a specification expects software to be the safety
system, that needs resolving before anything is built.
*Changes: everything. Ask it first.*

**17. After a safety trip, who may re-arm the stand, and from where?**
If it can be re-armed from a screen, it can be re-armed by someone who cannot see the machine. A
physical reset at the stand is slower and safer.
*Changes: whether there is any software path to restart, which there probably should not be.*

**18. Who needs to see a running test from outside the lab, and what may they do?**
Watching from a desk is obviously useful. Starting a test from a desk is obviously not. The
interesting question is the middle: may a remote user stop a run? We think yes — stopping is always
safe — and that this must be enforced by the controller rather than by hiding a button.
*Changes: the command model, and the honesty of your permission system.*

## Fluid and conditioning

**19. What is the lowest oil temperature at which the drive may be started?**
Cold-start testing deliberately approaches it. Everyday operation must not cross it by accident,
which means the interlock belongs in the system and not in a technician's memory.
*Changes: whether start is conditional, and on what.*

**20. Is fluid condition a test channel or a stand-health channel?**
Particle count, water content and viscosity can be either — data the test is about, or data that
tells you the stand needs attention. They are logged, alarmed and reported differently depending on
which.
*Changes: the channel model, and what appears on a maintenance screen rather than a test report.*

---

## Why we publish these

Because the answers change the design, and because a supplier who asks them before quoting is
cheaper than one who discovers them afterwards.

If you have a rig and most of these questions do not have a written answer, that is normal — and it
is worth half an hour of conversation before anyone writes a specification.

**[Makkal](https://makkal.co)** builds test-system software — DAQ, control, HMI and data — mostly on
NI cRIO and cDAQ. We modernise test rigs whose original software nobody can maintain any more.

**support@makkal.co**

*The demonstration interface these questions came from: https://makkal-co.github.io/anvil-pump-durability-demo/ — simulated data, not a product.*
