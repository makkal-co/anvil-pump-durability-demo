# Anvil — hydraulic pump durability demo

A clickable demonstration interface for a hydraulic pump endurance test lab, with a simulated rig
behind it. Open `index.html` — no install, no build, no network.

**This is a demonstration, not a product.** Everything in it is invented: the stands, the channels,
the procedures, the numbers and the people. It exists to show how we build test-system software, not
to describe a system anyone is running.

**Live:** https://makkal-co.github.io/anvil-pump-durability-demo/

---

## What it shows

Eight pump test stands across four bays, one of them running a 2 000-hour endurance procedure.

| Screen | What it demonstrates |
|---|---|
| **Lab Overview** | Every stand at once — state, procedure, progress, key readings |
| **Test Setups** | The procedure editor: typed steps, nested repeat loops, per-step limits and alarm arming, a profile preview, storage estimate, versioned save |
| **Manual Control** | Outputs with command and readback side by side, interlocks, both shutdown paths |
| **Live Trend** | Multi-channel trend over a long window, with procedure steps marked under the time axis |
| **Alarms** | Active and historical, each with the step it happened in and the action taken |
| **Run History** | Finished runs read from a network share, graphed and exportable |
| **Stand Config** | Channel map and calibration, sample-rate tiers with a live storage estimate, logging, users and permissions |
| **Remote view** | What the same system looks like from outside the lab — watch anything, stop anything, start nothing |

## Things worth clicking

1. **Demo ▾ → inject discharge over-temperature** on Stand 3, then watch the alarm escalate and the
   orderly shutdown sequence step through.
2. **Test Setups → Setpoints & timing** — a procedure with nested loops, and the storage estimate
   under the profile preview showing what the logging strategy actually costs.
3. **Stand Config → Sample rates & storage** — change a rate and watch the estimate move.
4. **Demo ▾ → open remote web view** — the same data, and a command set that cannot start a test.

Deep links for rehearsal:

```
index.html#user=eng.demo&screen=setups&tab=th
index.html#user=tech.demo&screen=manual&rack=4
index.html#user=eng.demo&screen=graph&rack=3
```

## Twenty questions your specification does not answer

The demo is the conversation starter; **[docs/questions.md](docs/questions.md)** is the useful part.
Twenty questions we end up asking on every test-system project — when a dwell actually starts, what
a conditional step does when it times out, whether case drain flow is judged against a limit or
against its own trend, who may switch an alarm off. Most of them change the design.

## What this does not model

Stated plainly, because a demonstration that overclaims is worse than none:

- **Conditional steps are not evaluated.** The simulator advances every step on time, including
  `DWELL UNTIL`. The condition and its timeout action are edited, saved and exported correctly, but
  the rig never tests them.
- **No cycle counter** that survives a restart.
- Step timing runs from step entry, not from a settled condition.
- The physics is plausible, not accurate. It exists so the screens have something to show.
- Nothing is persisted. Reloading the page resets everything.

## How it is built

Plain HTML, CSS and JavaScript. No framework, no build step, no dependencies, and nothing is fetched
from a network — it runs from `file://` as happily as from a web server. That is deliberate: the real
systems this demonstrates run in labs where a browser may have no internet at all.

```
index.html        frame, login, SVG symbols
css/              styling
js/data.js        channels, limits, stands, procedures  — the domain lives here
js/sim.js         the plant model
js/scr-*.js       one file per screen
```

To check a change without clicking through it:

```
chrome --headless=new --screenshot=shot.png --virtual-time-budget=3000 \
  "file:///path/to/index.html#user=eng.demo&screen=setups"
```

Script errors render as a red banner at the top of the page.

---

## Who made it

[Makkal](https://makkal.co) builds test-system software — DAQ, control, HMI and data — mostly on NI
cRIO and cDAQ. We modernise test rigs whose original software nobody can maintain any more.

If your lab has that problem, we would like to hear about it: **ajay@makkal.co**

*Demonstration interface. Simulated data. Not a product.*
