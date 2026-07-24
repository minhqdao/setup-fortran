[![GitHub Marketplace](https://img.shields.io/badge/Marketplace-setup--fortran-blueviolet?logo=github)](https://github.com/marketplace/actions/setup-fortran-compilers)
[![GitHub release](https://img.shields.io/github/v/release/minhqdao/setup-fortran?color=orange)](https://github.com/minhqdao/setup-fortran/releases)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

# setup-fortran

A GitHub Action to install and configure Fortran compilers across Linux, macOS, and Windows runners.

## Usage

```yaml
- uses: minhqdao/setup-fortran@v1
  with:
    compiler: <compiler>
    version: <version>
```

## Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `compiler` | Compiler to install (`gfortran`, `ifx`, `ifort`, `nvfortran`, `aocc`, `lfortran`, `flang`) | `gfortran` |
| `version` | Compiler version to install | `latest` |
| `msystem` | MSYS2 subsystem (`native`, `ucrt64`, `clang64`) | `native` |
| `cleanup-disk` | Free up disk space by removing large pre-installed toolkits during `nvfortran` setup (`true`, `false`) | `false` |

## Compiler support

### `gfortran`

| Version | ubuntu-24.04 | ubuntu-22.04 | ubuntu-24.04-arm | ubuntu-22.04-arm | macos-26 | macos-26-intel | macos-15 | macos-15-intel | macos-14 | windows-2025 | windows-2022 | windows-2025 (ucrt64) | windows-2022 (ucrt64) |
|---------|--------------|--------------|------------------|------------------|----------|----------------|----------|----------------|----------|--------------|--------------|----------------------|----------------------|
| latest  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 16      | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |   |   |
| 15      | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |   |   |
| 14      | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |   |   |
| 13      | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |   |   |
| 12      | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |   |   |
| 11      | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |   |   |

---

### `ifx`

| Version | ubuntu-24.04 | ubuntu-22.04 | windows-2025 | windows-2022 |
|---------|--------------|--------------|--------------|--------------|
| latest   | ✓ | ✓ | ✓ | ✓ |
| 2026.1   | ✓ | ✓ | ✓ | ✓ |
| 2026.0   | ✓ | ✓ | ✓ | ✓ |
| 2025.3.3 |   |   | ✓ | ✓ |
| 2025.3.2 |   |   | ✓ | ✓ |
| 2025.3.1 |   |   | ✓ | ✓ |
| 2025.3.0 |   |   | ✓ | ✓ |
| 2025.3   | ✓ | ✓ | ✓ | ✓ |
| 2025.2.1 |   |   | ✓ | ✓ |
| 2025.2.0 |   |   | ✓ | ✓ |
| 2025.2   | ✓ | ✓ | ✓ | ✓ |
| 2025.1.0 |   |   | ✓ | ✓ |
| 2025.1   | ✓ | ✓ | ✓ | ✓ |
| 2025.0.0 |   |   | ✓ | ✓ |
| 2025.0   | ✓ | ✓ | ✓ | ✓ |
| 2024.2.1 |   |   | ✓ | ✓ |
| 2024.2.0 |   |   | ✓ | ✓ |
| 2024.2   | ✓ | ✓ | ✓ | ✓ |
| 2024.1.0 |   |   | ✓ | ✓ |
| 2024.1   | ✓ | ✓ | ✓ | ✓ |
| 2024.0.2 |   |   | ✓ | ✓ |
| 2024.0.1 |   |   | ✓ | ✓ |
| 2024.0   | ✓ | ✓ | ✓ | ✓ |
| 2023.2.4 | ✓ | ✓ |   |   |
| 2023.2.3 | ✓ | ✓ |   |   |
| 2023.2.2 | ✓ | ✓ |   |   |
| 2023.2.1 | ✓ | ✓ | ✓ | ✓ |
| 2023.2.0 | ✓ | ✓ | ✓ | ✓ |
| 2023.2   | ✓ | ✓ | ✓ | ✓ |
| 2023.1.0 | ✓ | ✓ | ✓ | ✓ |
| 2023.1   | ✓ | ✓ | ✓ | ✓ |
| 2023.0.0 | ✓ | ✓ |   |   |
| 2023.0   | ✓ | ✓ |   |   |
| 2022.3.0 |   |   | ✓ | ✓ |
| 2022.3   |   |   | ✓ | ✓ |
| 2022.2.1 | ✓ | ✓ |   |   |
| 2022.2.0 | ✓ | ✓ | ✓ | ✓ |
| 2022.2   | ✓ | ✓ | ✓ | ✓ |
| 2022.1.0 | ✓ | ✓ |   |   |
| 2022.1   | ✓ | ✓ |   |   |
| 2022.0.2 | ✓ | ✓ |   |   |
| 2022.0.1 | ✓ | ✓ |   |   |
| 2022.0   | ✓ | ✓ |   |   |
| 2021.4.0 | ✓ | ✓ |   |   |
| 2021.4   | ✓ | ✓ |   |   |
| 2021.3.0 | ✓ | ✓ |   |   |
| 2021.3   | ✓ | ✓ |   |   |
| 2021.2.0 | ✓ | ✓ |   |   |
| 2021.2   | ✓ | ✓ |   |   |
| 2021.1.2 | ✓ | ✓ |   |   |
| 2021.1.1 | ✓ | ✓ |   |   |
| 2021.1   | ✓ | ✓ |   |   |

---

### `ifort`

| Version | ubuntu-24.04 | ubuntu-22.04 | macos-26-intel | macos-15-intel | windows-2025 | windows-2022 |
|---------|--------------|--------------|----------------|----------------|--------------|--------------|
| latest  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 2021.13 | ✓ | ✓ |   |   | ✓ | ✓ |
| 2021.12 | ✓ | ✓ |   |   | ✓ | ✓ |
| 2021.11 | ✓ | ✓ |   |   | ✓ | ✓ |
| 2021.10 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 2021.9  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 2021.8  | ✓ | ✓ | ✓ | ✓ |   |   |
| 2021.7  | ✓ | ✓ |   |   | ✓ | ✓ |
| 2021.6  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 2021.5  | ✓ | ✓ | ✓ | ✓ |   |   |
| 2021.4  | ✓ | ✓ |   |   |   |   |
| 2021.3  | ✓ | ✓ | ✓ | ✓ |   |   |
| 2021.2  | ✓ | ✓ | ✓ | ✓ |   |   |
| 2021.1  | ✓ | ✓ | ✓ | ✓ |   |   |

---

### `nvfortran`

| Version | ubuntu-24.04 | ubuntu-22.04 | ubuntu-24.04-arm | ubuntu-22.04-arm |
|---------|--------------|--------------|------------------|------------------|
| latest | ✓ | ✓ | ✓ | ✓ |
| 26.5   | ✓ | ✓ | ✓ | ✓ |
| 26.3   | ✓ | ✓ | ✓ | ✓ |
| 26.1   | ✓ | ✓ | ✓ | ✓ |
| 25.11  | ✓ | ✓ | ✓ | ✓ |
| 25.9   | ✓ | ✓ | ✓ | ✓ |
| 25.7   | ✓ | ✓ | ✓ | ✓ |
| 25.5   | ✓ | ✓ | ✓ | ✓ |
| 25.3   | ✓ | ✓ | ✓ | ✓ |
| 25.1   | ✓ | ✓ | ✓ | ✓ |
| 24.11  | ✓ | ✓ | ✓ | ✓ |
| 24.9   | ✓ | ✓ | ✓ | ✓ |
| 24.7   | ✓ | ✓ | ✓ | ✓ |
| 24.5   | ✓ | ✓ | ✓ | ✓ |
| 24.3   | ✓ | ✓ | ✓ | ✓ |
| 24.1   | ✓ | ✓ | ✓ | ✓ |
| 23.11  | ✓ | ✓ | ✓ | ✓ |
| 23.9   | ✓ | ✓ | ✓ | ✓ |
| 23.7   | ✓ | ✓ | ✓ | ✓ |
| 23.5   | ✓ | ✓ | ✓ | ✓ |
| 23.3   | ✓ | ✓ | ✓ | ✓ |
| 23.1   | ✓ | ✓ | ✓ | ✓ |
| 22.11  | ✓ | ✓ | ✓ | ✓ |
| 22.9   | ✓ | ✓ | ✓ | ✓ |
| 22.7   | ✓ | ✓ | ✓ | ✓ |
| 22.5   | ✓ | ✓ | ✓ | ✓ |
| 22.3   | ✓ | ✓ | ✓ | ✓ |
| 22.2   | ✓ | ✓ | ✓ | ✓ |
| 22.1   | ✓ | ✓ | ✓ | ✓ |
| 21.11  | ✓ | ✓ | ✓ | ✓ |
| 21.9   | ✓ | ✓ | ✓ | ✓ |
| 21.7   | ✓ | ✓ | ✓ | ✓ |
| 21.5   | ✓ | ✓ | ✓ | ✓ |
| 21.3   | ✓ | ✓ | ✓ | ✓ |
| 21.2   | ✓ | ✓ | ✓ | ✓ |
| 21.1   |   |   | ✓ | ✓ |
| 20.11  | ✓ | ✓ | ✓ | ✓ |

---

### `aocc`

| Version | ubuntu-24.04 | ubuntu-22.04 |
|---------|--------------|--------------|
| latest  | ✓ | ✓ |
| 5.2     | ✓ | ✓ |
| 5.1     | ✓ | ✓ |
| 5.0     | ✓ | ✓ |
| 4.2     | ✓ | ✓ |
| 4.1     | ✓ | ✓ |

---

### `lfortran`

| Version | ubuntu-24.04 | ubuntu-22.04 | macos-26 | macos-26-intel | macos-15 | macos-15-intel | macos-14 | windows-2025 | windows-2022 | windows-2025 (ucrt64) | windows-2022 (ucrt64) | windows-2025 (clang64) | windows-2022 (clang64) |
|---------|--------------|--------------|----------|----------------|----------|----------------|----------|--------------|--------------|----------------------|----------------------|----------------------|----------------------|
| latest  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 0.64.0  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |   |   |   |   |
| 0.63.0  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |   |   |   |   |
| 0.62.0  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |   |   |   |   |
| 0.61.0  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |   |   |   |   |
| 0.60.0  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |   |   |   |   |
| 0.59.0  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |   |   |   |   |
| 0.58.0  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |   |   |   |   |
| 0.57.0  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |   |   |   |   |

---


### `flang` (LLVM Flang)

| Version | ubuntu-24.04 | ubuntu-22.04 | ubuntu-24.04-arm | ubuntu-22.04-arm | macos-26 | macos-26-intel | macos-15 | macos-15-intel | macos-14 | windows-2025 | windows-2022 | windows-11-arm | windows-2025 (ucrt64) | windows-2022 (ucrt64) | windows-2025 (clang64) | windows-2022 (clang64) |
|---------|--------------|--------------|------------------|------------------|----------|----------------|----------|----------------|----------|--------------|--------------|----------------|----------------------|----------------------|----------------------|----------------------|
| latest  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 22      | ✓ | ✓ | ✓ | ✓ |   |   |   |   |   | ✓ | ✓ | ✓ |   |   |   |   |
| 21      | ✓ | ✓ | ✓ | ✓ | ✓ |   | ✓ |   |   |   |   | ✓ |   |   |   |   |
| 20      | ✓ | ✓ | ✓ | ✓ | ✓ |   | ✓ |   |   |   |   | ✓ |   |   |   |   |
| 19      | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |   |   |   |   |   |   |   |   |
| 18      | ✓ | ✓ | ✓ | ✓ |   |   |   |   |   |   |   |   |   |   |   |   |
| 17      | ✓ | ✓ | ✓ | ✓ |   |   |   |   |   |   |   |   |   |   |   |   |
| 16      |   | ✓ |   |   |   |   |   |   |   |   |   |   |   |   |   |   |

> Specific patch versions (e.g. `21.1.6`) are also accepted on macOS and native Windows runners and are validated against available GitHub releases. If the requested patch does not exist, an error is thrown. Patches aren't specifically tested.

## Examples

### Basic usage

```yaml
steps:
  - uses: actions/checkout@v7
  - uses: minhqdao/setup-fortran@v1
  - run: ${{ env.FC }} hello.f90
```

This defaults to `gfortran` and the newest version available on that platform.

### Specific version

```yaml
- uses: minhqdao/setup-fortran@v1
  with:
    compiler: lfortran
    version: "0.64.0"
```

### Matrix build

```yaml
strategy:
  matrix:
    os: [ubuntu-latest, macos-latest, windows-latest]
    toolchain:
      - { compiler: gfortran, version: "15" }
      - { compiler: ifx, version: "2016.1" }
      - { compiler: lfortran, version: "0.64.0" }
    exclude:
      - os: macos-latest
        toolchain: { compiler: ifx, version: "2016.1" }
    include:
      - os: windows-11-arm
        toolchain: { compiler: flang, version: "22"}
jobs:
  test:
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v7
      - uses: minhqdao/setup-fortran@v1
        with:
          compiler: ${{ matrix.toolchain.compiler }}
          version: ${{ matrix.toolchain.version }}
      - run: ${{ env.FC }} hello.f90
```

### Windows with MSYS2

```yaml
- uses: minhqdao/setup-fortran@v1
  with:
    compiler: lfortran
    msystem: ucrt64
```

## Outputs

| Output | Description |
|--------|-------------|
| `version` | Resolved version of the installed compiler |
| `fc` | Command or path to the Fortran compiler |
| `cc` | Command or path to the C compiler |
| `cxx` | Command or path to the C++ compiler |

## Environment variables set

| Variable | Description |
|----------|-------------|
| `FC` | Command or path to the Fortran compiler |
| `CC` | Command or path to the C compiler |
| `CXX` | Command or path to the C++ compiler |
| `FPM_FC` | Command or path to the Fortran compiler for fpm |
| `FPM_CC` | Command or path to the C compiler for fpm |
| `FPM_CXX` | Command or path to the C++ compiler for fpm |
| `F77` | Command or path to the Fortran compiler (alias for `FC`) |
| `F90` | Command or path to the Fortran compiler (alias for `FC`) |

## Development

GitHub Actions run the code straight from the `dist` folder. To bundle the content from the `src` into the `dist` folder including dependencies, run `npm run bundle`. Then commit the entire `dist` folder.

The integration tests are bundled, cached and executed in the CI, so you do not need to run `npm run build:integration-test` locally.

You can run `npm run all` to format, lint, run unit tests and bundle the code into the `dist` folder in one go.

## Reporting

Please submit an [issue](https://github.com/minhqdao/setup-fortran/issues) if you find a problem or would like features to be added.

## License

[Apache-2.0](LICENSE)
