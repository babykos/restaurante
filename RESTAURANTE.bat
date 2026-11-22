<# : batch
@echo off
setlocal
rem ==================================================================
rem  Instalador / actualizador de la app web Restaurante (meseros)
rem    1. Instala Node.js (LTS) si falta o es < 18
rem    2. Instala Git si falta
rem    3. Descarga el proyecto de GitHub (o lo actualiza si ya existe)
rem    4. Instala dependencias (npm ci)
rem    5. Si no existe .env, pide los datos y lo crea
rem    6. Crea el servicio de Windows via NSSM (si no existe) y lo inicia
rem
rem  Uso: copiar este archivo a la PC y darle doble clic.
rem  Instalacion offline: dejar junto a este .bat el instalador de Node
rem  (node-vXX-x64.msi) y/o de Git (Git-X.Y.Z-64-bit.exe) y se usaran
rem  en lugar de descargarlos.
rem ==================================================================
set "BOOTSTRAP_FILE=%~f0"
set "BOOTSTRAP_DIR=%~dp0"

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Solicitando permisos de administrador...
    powershell -NoProfile -Command "Start-Process -FilePath $env:BOOTSTRAP_FILE -Verb RunAs"
    exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "iex ([IO.File]::ReadAllText($env:BOOTSTRAP_FILE))"
pause
exit /b
#>

# ======================= CONFIGURACION =======================
$RepoUrl         = 'https://github.com/babykos/restaurante.git'
$RepoBranch      = 'main'
$DirDefecto      = 'C:\Program Files (x86)\Maverick\restaurante'
$ServicioDefecto = 'Restaurante'
$PuertoDefecto   = 3000
$NodeMinMajor    = 18

# Opcional: URLs propias (p.ej. en tu nube) de los instaladores.
# Si quedan vacias se descarga la ultima version oficial.
$NodeMsiUrl      = ''   # ej. 'https://mi-nube/node-v22.11.0-x64.msi'
$GitExeUrl       = ''   # ej. 'https://mi-nube/Git-2.47.1-64-bit.exe'

# Archivos locales que se conservan al actualizar un proyecto existente.
$Conservar       = @('.env')
# =============================================================

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'   # acelera Invoke-WebRequest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$BootDir = $env:BOOTSTRAP_DIR
$EsArm   = $env:PROCESSOR_ARCHITECTURE -eq 'ARM64'
$Temp    = Join-Path $env:TEMP 'restaurante_setup'
New-Item -ItemType Directory -Force -Path $Temp | Out-Null

function Paso($t)  { Write-Host ''; Write-Host "==> $t" -ForegroundColor Cyan }
function Ok($t)    { Write-Host "    $t" -ForegroundColor Green }
function Info($t)  { Write-Host "    $t" }
function Aviso($t) { Write-Host "    $t" -ForegroundColor Yellow }

function Actualizar-Path {
    $m = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $u = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$m;$u"
}

function Descargar($url, $destino) {
    Info "Descargando $url"
    Invoke-WebRequest -Uri $url -OutFile $destino -UseBasicParsing
}

function Buscar-Local($patron) {
    if (-not $BootDir) { return $null }
    Get-ChildItem -Path $BootDir -Filter $patron -File -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending | Select-Object -First 1 -ExpandProperty FullName
}

function Ejecutar($exe, $argumentos) {
    $p = Start-Process -FilePath $exe -ArgumentList $argumentos -Wait -PassThru
    if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) {
        throw "$exe termino con codigo $($p.ExitCode)"
    }
}

function Invocar-Git {
    & git.exe @args
    if ($LASTEXITCODE -ne 0) { throw "git $($args -join ' ') fallo (codigo $LASTEXITCODE)" }
}

function Version-Node {
    $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $cmd) { return $null }
    try { return [version]((& $cmd.Source -v) -replace '^v', '') } catch { return $null }
}

function Preguntar($texto, $defecto) {
    if ("$defecto" -ne '') { $r = Read-Host "    $texto [$defecto]" } else { $r = Read-Host "    $texto" }
    if (-not $r) { return "$defecto" }
    return $r.Trim()
}

function Preguntar-Obligatorio($texto, $defecto) {
    while ($true) {
        $r = Preguntar $texto $defecto
        if ($r) { return $r }
        Aviso 'Este dato es obligatorio.'
    }
}

function Preguntar-Numero($texto, $defecto) {
    while ($true) {
        $r = Preguntar $texto $defecto
        if ($r -match '^\d+$') { return [int]$r }
        Aviso 'Debe ser un numero entero.'
    }
}

function Preguntar-SiNo($texto, $defecto) {
    $r = Preguntar "$texto (S/N)" $defecto
    return $r -match '^[sSyY]'
}

function Preguntar-Clave($texto) {
    $seg = Read-Host "    $texto" -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($seg)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

# Ejecuta un programa externo sin que sus mensajes por stderr aborten el
# script. Devuelve el texto de salida limpio; el codigo queda en $CodigoNativo.
function Invocar-Nativo {
    $exe, $resto = $args
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $salida = (& $exe @resto 2>&1 | ForEach-Object { "$_" }) -join ' '
        $script:CodigoNativo = $LASTEXITCODE
        return ($salida -replace "`0", '').Trim()
    } finally { $ErrorActionPreference = $prev }
}

function Invocar-Nssm {
    $r = Invocar-Nativo $script:nssm @args
    $script:NssmCodigo = $script:CodigoNativo
    return $r
}

# Windows deja un servicio "marcado para eliminacion" (se ve Deshabilitado)
# mientras algun programa lo tenga abierto, p.ej. la consola de Servicios.
function Servicio-PendienteEliminar($nombre) {
    $k = Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Services\$nombre" -Name DeleteFlag -ErrorAction SilentlyContinue
    return ($k -and $k.DeleteFlag -eq 1)
}

function Aviso-PendienteEliminar($nombre) {
    Aviso "El servicio '$nombre' esta marcado para eliminacion y Windows aun no lo borra."
    Aviso 'Cierre la consola de Servicios (services.msc), el Visor de eventos y el'
    Aviso 'Administrador de tareas, y vuelva a ejecutar RESTAURANTE.bat.'
    Aviso 'Si el problema persiste, reinicie la PC.'
}

# Detiene y elimina un servicio. Devuelve $true si quedo eliminado del todo.
function Eliminar-Servicio($nombre) {
    Invocar-Nssm stop $nombre | Out-Null
    $r = Invocar-Nssm remove $nombre confirm
    if ($NssmCodigo -ne 0) {
        Info "nssm no pudo eliminarlo ($r); intentando con sc.exe..."
        Invocar-Nativo sc.exe delete $nombre | Out-Null
    }
    for ($i = 0; $i -lt 10; $i++) {
        if (-not (Get-Service -Name $nombre -ErrorAction SilentlyContinue)) { return $true }
        Start-Sleep -Seconds 1
    }
    if (Servicio-PendienteEliminar $nombre) { Aviso-PendienteEliminar $nombre }
    else { Aviso "No se pudo eliminar el servicio '$nombre': $r" }
    return $false
}

function Puerto-EnUso($puerto) {
    $c = Get-NetTCPConnection -State Listen -LocalPort $puerto -ErrorAction SilentlyContinue
    return [bool]$c
}

# Da formato a un valor para .env sin que dotenv lo altere (#, espacios, comillas...)
function Valor-Env($v) {
    if ($v -match '^[A-Za-z0-9_.@/:\-]*$') { return $v }
    if (-not $v.Contains("'")) { return "'$v'" }
    if (-not $v.Contains('"')) { return '"' + $v + '"' }
    return '`' + $v + '`'
}

function Leer-Env($archivo) {
    $vals = @{}
    if (Test-Path $archivo) {
        foreach ($l in Get-Content $archivo) {
            if ($l -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
                $vals[$matches[1]] = $matches[2].Trim().Trim("'", '"', '`')
            }
        }
    }
    return $vals
}

# Prueba la conexion a MySQL con mysql2 (del proyecto) y lista los restaurantes.
function Probar-BD($dir, $h, $p, $u, $c, $db) {
    $js = Join-Path $Temp 'probar_bd.js'
    $codigo = @'
const path = require('path');
const mysql = require(path.join(process.cwd(), 'node_modules', 'mysql2', 'promise'));
(async () => {
  const cn = await mysql.createConnection({
    host: process.env.T_HOST, port: Number(process.env.T_PORT),
    user: process.env.T_USER, password: process.env.T_PASS,
    database: process.env.T_DB, connectTimeout: 8000,
  });
  const [rows] = await cn.query('SELECT restauranteid, restaurante FROM restaurantes ORDER BY restauranteid');
  console.log('    Restaurantes registrados en la base de datos:');
  for (const r of rows) console.log('      ' + r.restauranteid + ' - ' + r.restaurante);
  await cn.end();
})().catch((e) => { console.error('    ' + e.message); process.exit(1); });
'@
    [IO.File]::WriteAllText($js, $codigo, (New-Object Text.UTF8Encoding($false)))
    $env:T_HOST = $h; $env:T_PORT = "$p"; $env:T_USER = $u; $env:T_PASS = $c; $env:T_DB = $db
    Push-Location $dir
    try {
        & node.exe $js | Out-Host
        return ($LASTEXITCODE -eq 0)
    } finally {
        Pop-Location
        Remove-Item Env:T_HOST, Env:T_PORT, Env:T_USER, Env:T_PASS, Env:T_DB -ErrorAction SilentlyContinue
        Remove-Item $js -Force -ErrorAction SilentlyContinue
    }
}

try {
    Actualizar-Path

    # ---------------------------------------------------------- Node.js
    Paso 'Verificando Node.js'
    $nv = Version-Node
    if ($nv -and $nv.Major -ge $NodeMinMajor) {
        Ok "Node.js $nv ya instalado"
    } else {
        if ($nv) { Info "Node.js $nv es muy antiguo (se requiere >= $NodeMinMajor)" }
        else     { Info 'Node.js no esta instalado' }

        $arq = if ($EsArm) { 'arm64' } else { 'x64' }
        $msi = Buscar-Local "node-v*-$arq.msi"
        if ($msi) {
            Info "Usando instalador local: $msi"
        } else {
            $url = $NodeMsiUrl
            if (-not $url) {
                $versiones = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -UseBasicParsing
                $lts = $versiones | Where-Object { $_.lts } | Select-Object -First 1
                $url = "https://nodejs.org/dist/$($lts.version)/node-$($lts.version)-$arq.msi"
            }
            $msi = Join-Path $Temp 'node.msi'
            Descargar $url $msi
        }
        Info 'Instalando Node.js (puede tardar un par de minutos)...'
        Ejecutar 'msiexec.exe' @('/i', "`"$msi`"", '/qn', '/norestart')
        Actualizar-Path
        $nv = Version-Node
        if (-not $nv) { throw 'Node.js no quedo disponible despues de instalarlo.' }
        Ok "Node.js $nv instalado"
    }

    # ---------------------------------------------------------- Git
    Paso 'Verificando Git'
    if (Get-Command git.exe -ErrorAction SilentlyContinue) {
        Ok "$(& git.exe --version) ya instalado"
    } else {
        Info 'Git no esta instalado'
        $exe = Buscar-Local $(if ($EsArm) { 'Git-*-arm64.exe' } else { 'Git-*-64-bit.exe' })
        if ($exe) {
            Info "Usando instalador local: $exe"
        } else {
            $url = $GitExeUrl
            if (-not $url) {
                $rel    = Invoke-RestMethod -Uri 'https://api.github.com/repos/git-for-windows/git/releases/latest' -UseBasicParsing
                $patron = if ($EsArm) { '^Git-[\d.]+-arm64\.exe$' } else { '^Git-[\d.]+-64-bit\.exe$' }
                $asset  = $rel.assets | Where-Object { $_.name -match $patron } | Select-Object -First 1
                if (-not $asset) { throw 'No se encontro el instalador de Git en GitHub. Configure $GitExeUrl.' }
                $url = $asset.browser_download_url
            }
            $exe = Join-Path $Temp 'git-setup.exe'
            Descargar $url $exe
        }
        Info 'Instalando Git...'
        Ejecutar $exe @('/VERYSILENT', '/NORESTART', '/NOCANCEL', '/SP-', '/SUPPRESSMSGBOXES')
        Actualizar-Path
        if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) { throw 'Git no quedo disponible despues de instalarlo.' }
        Ok "$(& git.exe --version) instalado"
    }

    # ---------------------------------------------------------- Proyecto
    Paso 'Proyecto'
    $dir = Preguntar 'Carpeta donde se descargara el proyecto' $DirDefecto
    $dir = $dir.Trim('"').TrimEnd('\')

    # Se clona como Administrador; sin esto git rechaza la carpeta
    # ("dubious ownership") cuando otro usuario haga git pull despues.
    $dirGit = $dir -replace '\\', '/'
    $seguros = & git.exe config --system --get-all safe.directory 2>$null
    if (-not ($seguros -contains $dirGit)) { Invocar-Git config --system --add safe.directory $dirGit }

    $nssm = Join-Path $dir 'resources\nssm.exe'

    if (Test-Path (Join-Path $dir '.git')) {
        Info "Ya existe una instalacion en $dir; se actualizara a la ultima version."

        # Detener los servicios NSSM que corren desde esta carpeta
        $nssmLower = $nssm.ToLower()
        Get-CimInstance Win32_Service |
            Where-Object { $_.State -eq 'Running' -and $_.PathName -and $_.PathName.ToLower().Contains($nssmLower) } |
            ForEach-Object { Info "Deteniendo servicio $($_.Name)"; Stop-Service -Name $_.Name -Force }

        $respaldo = @{}
        foreach ($f in $Conservar) {
            $p = Join-Path $dir $f
            if (Test-Path $p) { $respaldo[$f] = [IO.File]::ReadAllBytes($p) }
        }
        Invocar-Git -C $dir fetch origin $RepoBranch
        Invocar-Git -C $dir reset --hard "origin/$RepoBranch"
        foreach ($f in $respaldo.Keys) { [IO.File]::WriteAllBytes((Join-Path $dir $f), $respaldo[$f]) }
        Ok "Proyecto actualizado a $(& git.exe -C $dir log -1 --format='%h %s')"
    } elseif ((Test-Path $dir) -and (Get-ChildItem -Path $dir -Force | Select-Object -First 1)) {
        throw "La carpeta $dir existe, no esta vacia y no es un repositorio git."
    } else {
        $padre = Split-Path $dir -Parent
        if ($padre -and -not (Test-Path $padre)) { New-Item -ItemType Directory -Force -Path $padre | Out-Null }
        Invocar-Git clone --branch $RepoBranch $RepoUrl $dir
        Ok "Proyecto descargado en $dir"
    }

    if (-not (Test-Path $nssm)) { throw "No se encontro nssm.exe en $nssm" }

    # ---------------------------------------------------------- Dependencias
    Paso 'Instalando dependencias (npm ci)'
    Push-Location $dir
    try {
        & npm.cmd ci --omit=dev --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw "npm ci fallo (codigo $LASTEXITCODE)" }
    } finally { Pop-Location }
    Ok 'Dependencias instaladas'

    # ---------------------------------------------------------- .env
    Paso 'Configuracion (.env)'
    $envFile = Join-Path $dir '.env'
    if (Test-Path $envFile) {
        Ok 'El archivo .env ya existe; se conserva sin cambios.'
    } else {
        Info 'No existe el archivo .env. Ingrese los datos de configuracion:'
        Write-Host ''

        while ($true) {
            $puerto = Preguntar-Numero 'Puerto de la aplicacion web' $PuertoDefecto
            if (-not (Puerto-EnUso $puerto)) { break }
            Aviso "El puerto $puerto ya esta en uso por otro programa. Elija otro."
        }

        while ($true) {
            $dbHost = Preguntar-Obligatorio 'Servidor MySQL (host)' 'localhost'
            $dbPort = Preguntar-Numero      'Puerto MySQL' 3306
            $dbName = Preguntar-Obligatorio 'Nombre de la base de datos' ''
            $dbUser = Preguntar-Obligatorio 'Usuario MySQL' 'root'
            $dbPass = Preguntar-Clave       'Clave MySQL'

            Info 'Probando conexion a la base de datos...'
            if (Probar-BD $dir $dbHost $dbPort $dbUser $dbPass $dbName) {
                Ok 'Conexion exitosa.'
                break
            }
            Aviso 'No se pudo conectar con esos datos.'
            if (-not (Preguntar-SiNo 'Desea volver a ingresarlos?' 'S')) { break }
        }

        $restId = Preguntar-Numero 'ID del restaurante (RESTAURANTEID)' ''

        $bytes = New-Object byte[] 48
        [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        $secret = -join ($bytes | ForEach-Object { $_.ToString('x2') })

        $lineas = @(
            "PORT=$puerto",
            "SESSION_SECRET=$secret",
            "DB_HOST=$(Valor-Env $dbHost)",
            "DB_PORT=$dbPort",
            "DB_USER=$(Valor-Env $dbUser)",
            "DB_PASSWORD=$(Valor-Env $dbPass)",
            "DB_NAME=$(Valor-Env $dbName)",
            "RESTAURANTEID=$restId"
        )
        [IO.File]::WriteAllText($envFile, ($lineas -join "`r`n") + "`r`n", (New-Object Text.UTF8Encoding($false)))
        Ok "Archivo .env creado en $envFile"
    }

    $cfg = Leer-Env $envFile
    $puerto = if ($cfg['PORT']) { [int]$cfg['PORT'] } else { $PuertoDefecto }

    # ---------------------------------------------------------- Servicio
    Paso 'Servicio de Windows'
    $nombre = Preguntar 'Nombre del servicio' $ServicioDefecto
    $nodeExe = (Get-Command node.exe).Source
    $svc = Get-Service -Name $nombre -ErrorAction SilentlyContinue

    if ($svc -and (Servicio-PendienteEliminar $nombre)) {
        Aviso-PendienteEliminar $nombre
        throw "No se puede crear el servicio '$nombre' mientras siga marcado para eliminacion."
    }

    $crear = $true
    if ($svc) {
        $dirActual = Invocar-Nssm get $nombre AppDirectory
        if ($NssmCodigo -ne 0) { $dirActual = '' }
        if ($dirActual -and ($dirActual.TrimEnd('\') -ne $dir)) {
            Aviso "El servicio '$nombre' ya existe pero apunta a: $dirActual"
            if (Preguntar-SiNo "Reconfigurarlo para usar $dir ?" 'S') {
                Info 'Eliminando el servicio anterior...'
                if (-not (Eliminar-Servicio $nombre)) {
                    throw "No se pudo eliminar el servicio anterior '$nombre'."
                }
            } else {
                $crear = $false
            }
        } else {
            Ok "El servicio '$nombre' ya existe."
            $crear = $false
        }
    }

    if (-not $crear) {
        $tipo = (Get-CimInstance Win32_Service -Filter "Name='$nombre'").StartMode
        if ($tipo -eq 'Disabled') {
            Info 'El servicio estaba deshabilitado; se cambia a inicio automatico.'
            Invocar-Nssm set $nombre Start SERVICE_AUTO_START | Out-Null
        }
    }

    if ($crear) {
        Info "Creando el servicio '$nombre'..."
        $logs = Join-Path $dir 'logs'
        New-Item -ItemType Directory -Force -Path $logs | Out-Null
        $r = Invocar-Nssm install $nombre $nodeExe 'src\app.js'
        if ($NssmCodigo -ne 0) { throw "nssm install fallo (codigo $NssmCodigo): $r" }
        Invocar-Nssm set $nombre AppDirectory $dir                                 | Out-Null
        Invocar-Nssm set $nombre DisplayName 'Restaurante - App web meseros'       | Out-Null
        Invocar-Nssm set $nombre Description "App web de meseros (puerto $puerto)" | Out-Null
        Invocar-Nssm set $nombre Start SERVICE_AUTO_START                          | Out-Null
        Invocar-Nssm set $nombre AppEnvironmentExtra 'NODE_ENV=production'         | Out-Null
        Invocar-Nssm set $nombre AppStdout (Join-Path $logs 'service_stdout.log') | Out-Null
        Invocar-Nssm set $nombre AppStderr (Join-Path $logs 'service_stderr.log') | Out-Null
        Invocar-Nssm set $nombre AppRotateFiles 1                                  | Out-Null
        Invocar-Nssm set $nombre AppRotateBytes 5242880                            | Out-Null
        Invocar-Nssm set $nombre AppExit Default Restart                           | Out-Null
        Invocar-Nssm set $nombre AppRestartDelay 5000                              | Out-Null
        Ok "Servicio '$nombre' creado."
    }

    Info 'Iniciando el servicio...'
    $inicio = Get-Date
    if ((Get-Service -Name $nombre).Status -eq 'Running') { $salidaInicio = Invocar-Nssm restart $nombre }
    else { $salidaInicio = Invocar-Nssm start $nombre }

    # Se considera arrancado cuando el servicio esta Running y la app escucha
    # en el puerto (NSSM puede marcarlo Running aunque node se caiga y reinicie).
    $arranco = $false
    for ($i = 0; $i -lt 15; $i++) {
        Start-Sleep -Seconds 1
        $estado = (Get-Service -Name $nombre).Status
        if ($estado -eq 'Running' -and (Puerto-EnUso $puerto)) { $arranco = $true; break }
    }

    if ($arranco) {
        Ok "Servicio '$nombre' en ejecucion (puerto $puerto)."
    } else {
        Write-Host ''
        Write-Host "    El servicio '$nombre' no pudo arrancar (estado: $estado, puerto $puerto sin responder)." -ForegroundColor Red
        if ($salidaInicio) { Info "Respuesta de nssm: $salidaInicio" }

        $eventos = Get-WinEvent -FilterHashtable @{ LogName = 'Application'; ProviderName = 'nssm'; StartTime = $inicio } -ErrorAction SilentlyContinue |
            Where-Object { $_.Message -match [regex]::Escape($nombre) } | Select-Object -First 5
        if ($eventos) {
            Info 'Eventos de nssm (Visor de eventos > Aplicacion):'
            $eventos | ForEach-Object { Write-Host "      $(($_.Message -replace '\s+', ' ').Trim())" -ForegroundColor DarkGray }
        }

        $logErr = Invocar-Nssm get $nombre AppStderr
        if ($NssmCodigo -ne 0 -or -not $logErr) { $logErr = Join-Path $dir 'logs\service_stderr.log' }
        if (Test-Path $logErr) {
            Info "Ultimas lineas de ${logErr}:"
            Get-Content $logErr -Tail 15 | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkGray }
        }

        Write-Host ''
        Aviso 'Se sugiere eliminar el servicio, corregir el problema (p.ej. datos del .env)'
        Aviso 'y volver a ejecutar RESTAURANTE.bat para crearlo de nuevo.'
        if (Preguntar-SiNo "Desea eliminar el servicio '$nombre'?" 'S') {
            if (Eliminar-Servicio $nombre) { Ok "Servicio '$nombre' eliminado." }
        } else {
            Info "El servicio se conserva. Revise el log: $logErr"
        }
        throw "El servicio '$nombre' no arranco."
    }

    # ---------------------------------------------------------- Resumen
    $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } |
        Select-Object -ExpandProperty IPAddress
    Write-Host ''
    Write-Host '==============================================='  -ForegroundColor Green
    Write-Host ' Restaurante instalado y en ejecucion'            -ForegroundColor Green
    Write-Host "   Carpeta : $dir"
    Write-Host "   Servicio: $nombre"
    Write-Host "   Local   : http://localhost:$puerto"
    foreach ($ip in $ips) { Write-Host "   Intranet: http://${ip}:$puerto" }
    Write-Host '==============================================='  -ForegroundColor Green
    exit 0
} catch {
    Write-Host ''
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
