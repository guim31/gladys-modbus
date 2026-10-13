# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

- **Stored in `/data`**: `modbus-layouts.json`, what the probe of each device
  found (SunSpec models with the manufacturer, model, firmware version and
  serial number; the presence of a Huawei meter or battery). Nothing else.
- **Secrets**: none. Modbus has no authentication; the configuration holds
  addresses, ports, unit ids and register descriptions. An address typed with
  credentials (`user:password@host`) is refused, and its credentials are never
  echoed in the logs or the connection status.
- **Network**: the integration opens TCP connections to the addresses
  configured by the user, and nowhere else (no cloud, no discovery). It
  listens on no port.
- **Writes**: off by default. When the user turns writing on, only the
  registers declared as a switch or a bounded setpoint are written, and a
  setpoint outside its declared bounds is refused. A way to make the
  integration write a register the user did not declare, or a value outside
  the declared bounds, is a vulnerability.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
the Modbus devices and gateways (Modbus TCP is unauthenticated by design:
anyone on the network can read and write them), and the third-party services
the integration does not talk to.
