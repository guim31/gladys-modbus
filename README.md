# Modbus TCP for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com)
that reads, and on request writes, the registers of **Modbus TCP** devices on
the local network: energy meters, solar inverters, batteries, heat pumps,
ventilation units, PLCs. Ready profiles cover the most common devices; for the
others, the registers are described in a one-line syntax in the configuration,
without editing any YAML.

> **Developed without the hardware: feedback welcome.** The profiles follow
> the manufacturers' published register tables and are tested against
> simulated Modbus devices built from those tables (and against an independent
> Modbus TCP server, jsmodbus), not against real devices. Please report what
> works and what does not in the
> [issues](https://github.com/guim31/gladys-modbus/issues), with the output of
> the **Test a read** button.

## Features

- **Up to four Modbus devices**, each one a Gladys device: a Modbus TCP device,
  or an RS-485 device behind a Modbus TCP gateway (several devices can share a
  gateway, each with its unit id; they share one connection and their
  requests are queued). Modbus RTU through a transparent gateway ("RTU over
  TCP", USR / Waveshare / Elfin) is supported too.
- **Ready profiles**:
  - **Eastron SDM630** and **SDM120** meters: power (total and per phase),
    voltage, current, energy imported and exported;
  - **SunSpec**, the register map of many inverters and meters (SMA,
    SolarEdge, Fronius, Kostal, ABB/FIMER, Huawei with the SunSpec option...):
    the models the device announces are detected (common, inverters 101-103
    and 111-113, meters 201-204 and 211-214), and the device is named after
    its manufacturer and model;
  - **Huawei SUN2000** inverters, with their power meter and LUNA2000 battery
    when present;
  - **Victron GX** (Cerbo GX, Venus GX, Ekrano): grid, house consumption,
    solar power, battery.
- **Custom registers** for everything else: holding and input registers,
  coils, discrete inputs, `int16` to `uint64`, `float32`/`float64`, one bit of
  a register, the four word and byte orders of Home Assistant (`swap=word`...),
  scale, offset, unit, and the kind of value (temperature, power, energy...).
  Every mistake is reported entry by entry, with the word at fault.
- **Energy tracking**: the energy indexes are published in kWh as
  `energy-sensor/index`; Gladys adds the 30-minute consumption and its cost.
- **Writing, off by default**: only the registers declared as `switch`
  (coil or register) or `setpoint` (a temperature with mandatory bounds) can be
  changed, and only once **Allow writing** is on. They are not exposed to the
  voice assistants.
- **Grouped reads** of contiguous registers (split automatically when a device
  refuses a range), a reading pace from 5 seconds to 5 minutes, slowed down by
  itself to stay within the 300 values a minute Gladys accepts, one connection
  per gateway, clean reconnection with back-off, failures logged once.
- **Test a read** (Configuration screen): the raw words of a register and what
  they read as in every data type and word order; `sunspec` lists the models
  of a device. **Check the configuration**: the mistakes, and whether each
  device answers.
- **Dashboard widget** "Modbus device": the main values of a device as live
  tiles, and the health of its link.
- **Scene triggers**: _A Modbus device stops answering_, _A Modbus device
  answers again_.
- Every text in English, French, German and Spanish.

## Requirements

- Gladys Assistant **5.1.0** or later (widgets and scene triggers).
- A device reachable over Modbus TCP from the Gladys host, with Modbus TCP
  enabled on it (or a Modbus TCP gateway in front of an RS-485 device), at a
  **fixed IP address**: the device is identified by its address, port and unit
  id.

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the
   address of this repository: `https://github.com/guim31/gladys-modbus`
   (or install **Modbus TCP** from the catalog once it is listed).
2. In **Configuration**, fill in a device: address, port (502), unit id, then
   a profile or custom registers. Save, then click **Check the
   configuration**.
3. Open the **Discover** tab and add the devices.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

- The Modbus client is written for this integration (`src/modbus/`, no
  dependency besides the SDK): Modbus TCP (MBAP) and RTU framing over TCP
  (CRC-16), function codes 1, 2, 3, 4 (reads), 5, 6 and 16 (writes). One
  connection per gateway, one request at a time on it (RS-485 is half duplex,
  and Huawei inverters mishandle concurrent requests); a refused connection is
  retried after 1 s, 2 s, 4 s... up to a minute; a connection the device
  dropped is reopened, and a request it interrupted is retried once; an
  answer that arrives after its timeout is never taken for the next one.
  `modbus-serial` and `jsmodbus` were considered: the first pulls the native
  `serialport` module (useless in a container without a serial port, heavy on
  arm64), the second calls its 5.0 an "early beta"; a Modbus TCP client is a
  few hundred lines, and owning it gives the queue, the RTU framing and the
  timeouts this integration needs. jsmodbus serves as an independent Modbus
  TCP server in the tests.
- The container polls the devices the user added by itself, at the chosen
  pace; the devices are also published with `should_poll: true` and a one
  minute `poll_frequency`, and the core's poll is a fallback, skipped when the
  timer just read the device (GladysAssistant/Gladys#3198).
- Only the values that changed are sent (the SDK's `publishChangedStates`),
  plus each value once every 6 hours, and every value at once when a device is
  added.
- A device is declared unreachable after two failed reads in a row (at once
  when it never answered): one warning, one scene event, one line in the
  connection status; its recovery likewise.
- What a SunSpec, Huawei or Victron device has (its models, a meter, a
  battery) is read once and kept in `/data/modbus-layouts.json`, so a device
  asleep at restart (an inverter at night) is still published. Nothing else
  is stored; the configuration has no secret.

## Checked, and what was not

- Checked by the tests (`npm test`): the client against a fake
  Modbus server written independently (both framings, exceptions, timeouts,
  dropped connections, busy devices, queueing) and against jsmodbus; every
  profile against register maps filled after the manufacturers' tables (SMA
  Sunny Boy, SolarEdge with meter, Fronius in float mode with its Smart Meter,
  Huawei with and without meter and battery, Victron with and without
  battery); the SunSpec offsets against the official SunSpec model
  definitions; a SunSpec answer captured by pysunspec2; every device against
  the category/type/unit table of the Gladys core.
- Not checked: any real device or gateway, and a real Gladys instance. The
  values most worth checking on real hardware: the sign of the SunSpec meter
  power (manufacturer-dependent), the Huawei meter detection (status register 37100) and the "busy" behaviour of Huawei inverters at startup, the Victron
  registers of a system without battery, and the SMA SunSpec unit id (126).
  `scripts/probe.mjs` reads a real device read-only and prints what the
  integration would publish.

## Limitations

- Four devices at most, 40 custom registers per device.
- Modbus TCP and RTU over TCP only: no serial port in the container, no Modbus
  UDP or ASCII. No discovery: Modbus has none.
- SunSpec: inverter and meter models only (no storage model 802, no MPPT
  model 160).
- Writing: switches and temperature setpoints only (Gladys has no neutral
  numeric control that stays away from the room temperature and the voice
  assistants); no single bit of a register, no 64-bit value.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
node scripts/probe.mjs --host 192.0.2.10 --unit 1 --profile sunspec   # read-only, real device
```

The tests use the fake Gladys of the SDK (`@gladysassistant/integration-sdk/testing`)
and fake Modbus devices on 127.0.0.1 (`test/helpers/fakeModbus.js`,
`test/fixtures/devices.js`). See [`CLAUDE.md`](CLAUDE.md) for the project
rules.

Releases go through **Actions → Release** (it bumps `package.json`, the
manifest `version` and `docker_image`, and rolls `CHANGELOG.md`). A
hand-pushed `vX.Y.Z` tag only builds the image: bump `version` in
`package.json` and in the manifest (with the `docker_image` tag) and commit it
before tagging.

## Credits

- [SunSpec Alliance](https://sunspec.org): the SunSpec Information Model
  definitions ([sunspec/models](https://github.com/sunspec/models),
  Apache-2.0), copied in `test/fixtures/sunspec/` to check the offsets, and
  [pysunspec2](https://github.com/sunspec/pysunspec2) (Apache-2.0), whose test
  frames are reused.
- Home Assistant's [`modbus`](https://github.com/home-assistant/core/tree/dev/homeassistant/components/modbus)
  integration (Apache-2.0): the names of the word and byte orders
  (`swap`), the data types and the pitfalls it documents.
- [volkszaehler/mbmd](https://github.com/volkszaehler/mbmd) by Mathias
  Dalheimer, Andreas Goetz and contributors (BSD-3-Clause): the Eastron
  register maps, cross-checked with Eastron's protocol documents.
- [sfstar/hass-victron](https://github.com/sfstar/hass-victron) (Apache-2.0):
  the Victron GX register list, cross-checked with Victron's "CCGX Modbus TCP
  register list".
- [wlcrs/huawei-solar-lib](https://github.com/wlcrs/huawei-solar-lib): read
  to cross-check the Huawei register addresses and gains of Huawei's "Solar
  Inverter Modbus Interface Definitions"; no code was copied (AGPL).
- [jsmodbus](https://github.com/Cloud-Automation/node-modbus) (MIT): the
  independent Modbus TCP server of the interoperability test.
- The architecture and the conformity tests follow
  [gladys-wled](https://github.com/guim31/gladys-wled) and
  [gladys-subsonic](https://github.com/guim31/gladys-subsonic).

## Disclaimer

Modbus is an open protocol (Modbus Organization). This project is not
affiliated with, endorsed or sponsored by Eastron, SMA Solar Technology,
SolarEdge, Fronius, Kostal, Huawei, Victron Energy or the SunSpec Alliance;
their names are trademarks of their owners.

## License

Apache-2.0
