# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-13

### Added

- Up to four Modbus TCP devices, each one a Gladys device, directly or behind a
  Modbus TCP gateway; RS-485 gateways in transparent mode ("RTU over TCP") too.
  Several devices behind one gateway share its connection.
- Ready profiles: Eastron SDM630 and SDM120 meters, SunSpec inverters and
  meters (models detected: SMA, SolarEdge, Fronius, Kostal...), Huawei SUN2000
  inverters with their meter and battery, Victron GX systems.
- Custom registers in a one-line syntax: holding and input registers, coils,
  discrete inputs, 16 to 64-bit integers and floats, one bit of a register,
  word and byte orders, scale, offset, unit and kind. Mistakes are reported
  entry by entry, with the word at fault.
- Energy indexes in kWh, with the energy tracking of Gladys.
- Writing, off by default, for the registers declared as a switch or a bounded
  temperature setpoint only.
- Grouped reads, a reading pace from 5 seconds to 5 minutes (slowed down to
  stay within what Gladys accepts), reconnection with back-off, calm logs.
- **Test a read** and **Check the configuration** buttons in the
  Configuration screen.
- The **Modbus device** dashboard widget, and the scene triggers _A Modbus
  device stops answering_ and _A Modbus device answers again_.
- English, French, German and Spanish everywhere, documentation included.

[Unreleased]: https://github.com/guim31/gladys-modbus/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-modbus/releases/tag/v1.0.1
