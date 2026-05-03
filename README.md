# setup-fortran

A GitHub Action to install and configure Fortran compilers across Linux, macOS, and Windows.

## Usage

```yaml
- uses: minhqdao/setup-fortran@v1
```

## Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `compiler` | Compiler to install (`gfortran`, `ifx`, `ifort`, `nvfortran`, `aocc`, `lfortran`, `flang`) | `gfortran` |
| `version` | Compiler version to install | `latest` |
| `windows-env` | Windows environment (`native`, `ucrt64`, `clang64`) | `native` |

## Outputs

| Output | Description |
|--------|-------------|
| `fc` | Path to the Fortran compiler executable |
| `version` | Resolved version of the installed compiler |

## Environment variables set

| Variable | Description |
|----------|-------------|
| `FC` | Path to the Fortran compiler |
| `CC` | Path to the C compiler (where applicable) |
| `CXX` | Path to the C++ compiler (where applicable) |
| `FORTRAN_COMPILER` | Compiler name (e.g. `flang`) |
| `FORTRAN_COMPILER_VERSION` | Major version installed, or `latest` |

---

## Compiler support

### `gfortran`

| Version | Linux x64 | Linux ARM64 | macOS x64 | macOS ARM64 | Windows x64 |
|---------|-----------|-------------|-----------|-------------|-------------|
| latest  | ✅ | ✅ | ✅ | ✅ | ✅ |
| ...     | | | | | |

---

### `flang` (LLVM Flang)

#### Linux

| Version | x64 | ARM64 |
|---------|-----|-------|
| 15      | ✅  | ❌    |
| 16      | ✅  | ❌    |
| 17      | ✅  | ✅    |
| ...     | ✅  | ✅    |

> Installed via `apt.llvm.org`. Major versions only.

#### macOS

| Version | x64 | ARM64 |
|---------|-----|-------|
| latest  | ✅  | ✅    |

> Installed via Homebrew. `latest` only.

#### Windows

| Version | x64 (`native`) | x64 (`ucrt64`) | x64 (`clang64`) | ARM64 (`native`) |
|---------|---------------|----------------|-----------------|-----------------|
| latest  | ❌            | ✅             | ✅              | ❌              |
| 20      | ❌            | ❌             | ❌              | ✅              |
| 21      | ❌            | ❌             | ❌              | ✅              |
| 22      | ✅            | ❌             | ❌              | ✅              |

> `native`: official LLVM installer. `ucrt64`/`clang64`: MSYS2 rolling release.

---

### `ifx` / `ifort`

| Version | Linux x64 | macOS x64 | Windows x64 |
|---------|-----------|-----------|-------------|
| latest  | ✅ | ✅ | ✅ |
| ...     | | | |

---

### `nvfortran`

| Version | Linux x64 | Windows x64 |
|---------|-----------|-------------|
| latest  | ✅ | ✅ |
| ...     | | | |

---

### `lfortran`

#### Linux / macOS

| Version | Linux x64 | Linux ARM64 | macOS x64 | macOS ARM64 |
|---------|-----------|-------------|-----------|-------------|
| latest  | ✅ | ✅ | ✅ | ✅ |
| ...     | | | | |

#### Windows

| Version | x64 (`native`) | x64 (`ucrt64`) | x64 (`clang64`) |
|---------|---------------|----------------|-----------------|
| latest  | ❌            | ✅             | ✅              |
| 0.63.0  | ✅            | ❌             | ❌              |
| ...     | ✅            | ❌             | ❌              |

> `native`: conda-forge. `ucrt64`/`clang64`: MSYS2 rolling release.

---

### `aocc`

| Version | Linux x64 |
|---------|-----------|
| latest  | ✅ |
| ...     | |

---

## Examples

### Basic usage

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: your-org/setup-fortran@v1
    with:
      compiler: gfortran
  - run: gfortran hello.f90 -o hello
```

### Specific version

```yaml
- uses: your-org/setup-fortran@v1
  with:
    compiler: flang
    version: "22"
```

### Matrix build

```yaml
strategy:
  matrix:
    compiler: [gfortran, flang, ifx]
    os: [ubuntu-latest, macos-latest, windows-latest]
jobs:
  test:
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: your-org/setup-fortran@v1
        with:
          compiler: ${{ matrix.compiler }}
      - run: ${{ env.FC }} hello.f90 -o hello
```

### Windows with MSYS2

```yaml
- uses: your-org/setup-fortran@v1
  with:
    compiler: flang
    version: latest
    windows-env: ucrt64
```

## License

MIT
