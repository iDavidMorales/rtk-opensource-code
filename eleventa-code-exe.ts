import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BUILD_VERSION } from './version';

const POWERSHELL_GUI = `param([string]$ExePath, [string]$ConfigPath)
$BuildVersion = '${BUILD_VERSION}'

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$nl = [Environment]::NewLine
$AppId = 'Routicket.DevServiceRtk'

function Show-Toast([string]$title, [string]$body) {
    try {
        [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime]
        [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType=WindowsRuntime]
        $template = @"
<toast>
  <visual>
    <binding template="ToastGeneric">
      <text>$([System.Security.SecurityElement]::Escape($title))</text>
      <text>$([System.Security.SecurityElement]::Escape($body))</text>
    </binding>
  </visual>
</toast>
"@
        $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
        $xml.LoadXml($template)
        $toast = New-Object Windows.UI.Notifications.ToastNotification $xml
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($AppId).Show($toast)
        return $true
    } catch {
        return $false
    }
}

function Show-BalloonFallback([string]$title, [string]$body) {
    if ($null -eq $script:trayIcon) {
        $script:trayIcon = New-Object System.Windows.Forms.NotifyIcon
        $ico = $null
        if ($null -ne $script:appIcon) { $ico = $script:appIcon }
        else {
            try { $ico = [System.Drawing.Icon]::ExtractAssociatedIcon($ExePath) } catch {}
        }
        if ($null -eq $ico) { $ico = [System.Drawing.SystemIcons]::Information }
        $script:trayIcon.Icon = $ico
        $script:trayIcon.Visible = $true
        $script:trayIcon.Text = 'dev-service-rtk'
    }
    $script:trayIcon.BalloonTipTitle = $title
    $script:trayIcon.BalloonTipText  = $body
    $script:trayIcon.BalloonTipIcon  = 'Info'
    $script:trayIcon.ShowBalloonTip(5000)
}

function Notify([string]$title, [string]$body) {
    $ok = Show-Toast $title $body
    if (-not $ok) { Show-BalloonFallback $title $body }
}

$cfg = $null
if (Test-Path $ConfigPath) {
    try { $cfg = Get-Content -Raw -Encoding UTF8 $ConfigPath | ConvertFrom-Json } catch { $cfg = $null }
}
function GetField($obj, $section, $key, $default) {
    if ($null -eq $obj) { return $default }
    $sec = $obj.$section
    if ($null -eq $sec) { return $default }
    $val = $sec.$key
    if ($null -eq $val -or $val -eq '') { return $default }
    return [string]$val
}

$form = New-Object Windows.Forms.Form
$form.Text = "dev-service-rtk $BuildVersion — recepción Routicket"
$form.Size = New-Object Drawing.Size(900, 800)
$form.StartPosition = 'CenterScreen'
$form.MinimumSize = New-Object Drawing.Size(900, 700)
try {
    $script:appIcon = [System.Drawing.Icon]::ExtractAssociatedIcon($ExePath)
    if ($null -ne $script:appIcon) { $form.Icon = $script:appIcon }
} catch { $script:appIcon = $null }

# ----- Bloque de config -----
$grpCfg = New-Object Windows.Forms.GroupBox
$grpCfg.Text = 'Configuración'
$grpCfg.Location = New-Object Drawing.Point(10, 10)
$grpCfg.Size = New-Object Drawing.Size(865, 230)
$grpCfg.Anchor = 'Top,Left,Right'
$form.Controls.Add($grpCfg)

function Add-Row($grp, $label, $y, $default, [bool]$pwd = $false, [bool]$browse = $false) {
    $l = New-Object Windows.Forms.Label
    $l.Text = $label
    $l.Location = New-Object Drawing.Point(15, $y + 3)
    $l.Size = New-Object Drawing.Size(130, 20)
    $grp.Controls.Add($l)

    $t = New-Object Windows.Forms.TextBox
    $t.Location = New-Object Drawing.Point(150, $y)
    $tw = if ($browse) { 600 } else { 690 }
    $t.Size = New-Object Drawing.Size($tw, 24)
    $t.Anchor = 'Top,Left,Right'
    $t.Text = $default
    if ($pwd) { $t.UseSystemPasswordChar = $true }
    $grp.Controls.Add($t)

    if ($browse) {
        $b = New-Object Windows.Forms.Button
        $b.Text = 'Buscar...'
        $b.Location = New-Object Drawing.Point(($t.Right + 5), ($y - 1))
        $b.Size = New-Object Drawing.Size(85, 26)
        $b.Anchor = 'Top,Right'
        $b.Add_Click({
            $dlg = New-Object Windows.Forms.OpenFileDialog
            $dlg.Filter = 'Firebird DB (*.fdb;*.FDB)|*.fdb;*.FDB|All files (*.*)|*.*'
            if ($dlg.ShowDialog() -eq 'OK') { $t.Text = $dlg.FileName }
        })
        $grp.Controls.Add($b)
    }
    return $t
}

$y = 25
$tbDb   = Add-Row $grpCfg 'Archivo .fdb (server-side):' $y (GetField $cfg 'firebird' 'database' '/var/lib/firebird/data/PDVDATA.FDB') $false $true
$y += 30
$tbHost = Add-Row $grpCfg 'Host Firebird:' $y (GetField $cfg 'firebird' 'host' '127.0.0.1')
$y += 30
$tbPort = Add-Row $grpCfg 'Puerto:' $y (GetField $cfg 'firebird' 'port' '3050')
$y += 30
$tbUser = Add-Row $grpCfg 'Usuario:' $y (GetField $cfg 'firebird' 'user' 'sysdba')
$y += 30
$tbPwd  = Add-Row $grpCfg 'Contraseña:' $y (GetField $cfg 'firebird' 'password' 'masterkey')
$y += 30
$tbEp   = Add-Row $grpCfg 'API endpoint:' $y (GetField $cfg 'api' 'endpoint' 'https://routicket.com/api/eleventa/recibir-tickets.php')
$grpCfg.Height = ($y + 50)

# ----- Fila de botones por pasos -----
function New-StepButton([string]$text, [int]$x, [int]$y, [int]$w, $bg) {
    $b = New-Object Windows.Forms.Button
    $b.Text = $text
    $b.Location = New-Object Drawing.Point($x, $y)
    $b.Size = New-Object Drawing.Size($w, 36)
    $b.FlatStyle = 'Flat'
    $b.BackColor = $bg
    $b.ForeColor = [Drawing.Color]::White
    $b.Font = New-Object Drawing.Font('Segoe UI', 9, [Drawing.FontStyle]::Bold)
    $form.Controls.Add($b)
    return $b
}

$rowY  = $grpCfg.Bottom + 12
$grayBg   = [Drawing.Color]::FromArgb(96, 96, 96)
$blueBg   = [Drawing.Color]::FromArgb(0, 120, 215)
$greenBg  = [Drawing.Color]::FromArgb(40, 140, 60)
$tealBg   = [Drawing.Color]::FromArgb(0, 140, 140)
$orangeBg = [Drawing.Color]::FromArgb(200, 120, 30)

$btnSelDb   = New-StepButton '1. Seleccionar BD'        10  $rowY 140 $grayBg
$btnConn    = New-StepButton '2. Probar conexión'       155 $rowY 140 $blueBg
$btnData    = New-StepButton '3. Probar acceso datos'   300 $rowY 155 $tealBg
$btnRouti   = New-StepButton '4. Probar Routicket'      460 $rowY 150 $orangeBg
$btnToggle  = New-StepButton '5. Activar recepción'     620 $rowY 255 $greenBg
$btnToggle.Anchor = 'Top,Right'

$rowY2 = $rowY + 44
$btnConf    = New-StepButton 'Verificar firebird.conf'  10  $rowY2 220 $grayBg
$btnUninst  = New-StepButton 'Desinstalar dev-service-rtk' 620 $rowY2 255 ([Drawing.Color]::FromArgb(160, 50, 50))
$btnUninst.Anchor = 'Top,Right'

# Etiqueta informativa de auth (hardcoded)
$lblAuth = New-Object Windows.Forms.Label
$lblAuth.Text = 'Auth: tienda_00192 · elv_win_001  (fijo en código)'
$lblAuth.Location = New-Object Drawing.Point(240, ($rowY2 + 10))
$lblAuth.Size = New-Object Drawing.Size(370, 22)
$lblAuth.ForeColor = [Drawing.Color]::FromArgb(160, 160, 160)
$form.Controls.Add($lblAuth)

# ----- Indicador de estado -----
$lblStatus = New-Object Windows.Forms.Label
$lblStatus.Text = 'Estado: inactivo  ·  flujo sugerido: 1 → 2 → 3 → 4 → 5'
$lblStatus.Location = New-Object Drawing.Point(10, ($rowY2 + 46))
$lblStatus.Size = New-Object Drawing.Size(865, 20)
$lblStatus.ForeColor = [Drawing.Color]::FromArgb(200, 200, 200)
$lblStatus.Anchor = 'Top,Left,Right'
$form.Controls.Add($lblStatus)

# ----- Paneles de log -----
function New-LogPanel($title, $x, $y, $w, $h, $anchor) {
    $g = New-Object Windows.Forms.GroupBox
    $g.Text = $title
    $g.Location = New-Object Drawing.Point($x, $y)
    $g.Size = New-Object Drawing.Size($w, $h)
    $g.Anchor = $anchor

    $rtb = New-Object Windows.Forms.RichTextBox
    $rtb.Location = New-Object Drawing.Point(8, 22)
    $rtb.Size = New-Object Drawing.Size(($w - 16), ($h - 30))
    $rtb.ReadOnly = $true
    $rtb.BackColor = [Drawing.Color]::FromArgb(20, 20, 20)
    $rtb.ForeColor = [Drawing.Color]::WhiteSmoke
    $rtb.Font = New-Object Drawing.Font('Consolas', 9)
    $rtb.Anchor = 'Top,Bottom,Left,Right'
    $rtb.WordWrap = $true
    $rtb.HideSelection = $false
    $g.Controls.Add($rtb)
    return @{ Group = $g; Rtb = $rtb }
}

$panelTop = ($rowY2 + 75)
$footerH  = 40
$panelH   = (($form.ClientSize.Height - $panelTop - $footerH - 20) / 3)

$dbPanel  = New-LogPanel '1) Conexión a Firebird'              10 $panelTop  865 $panelH 'Top,Bottom,Left,Right'
$apiPanel = New-LogPanel '2) Envío a Routicket'                10 ($panelTop + $panelH + 5) 865 $panelH 'Top,Bottom,Left,Right'
$errPanel = New-LogPanel '3) Errores'                          10 ($panelTop + 2 * $panelH + 10) 865 $panelH 'Top,Bottom,Left,Right'
$form.Controls.Add($dbPanel.Group)
$form.Controls.Add($apiPanel.Group)
$form.Controls.Add($errPanel.Group)

# ----- Footer Routicket -----
$footerY = $form.ClientSize.Height - $footerH
$footerPanel = New-Object Windows.Forms.Panel
$footerPanel.Location = New-Object Drawing.Point(0, $footerY)
$footerPanel.Size = New-Object Drawing.Size($form.ClientSize.Width, $footerH)
$footerPanel.BackColor = [Drawing.Color]::FromArgb(30, 30, 30)
$footerPanel.Anchor = 'Bottom,Left,Right'
$form.Controls.Add($footerPanel)

$lblFooter = New-Object Windows.Forms.Label
$lblFooter.Text = 'dev-service-rtk · Sincronizador oficial para Routicket · '
$lblFooter.AutoSize = $true
$lblFooter.Location = New-Object Drawing.Point(12, 12)
$lblFooter.ForeColor = [Drawing.Color]::FromArgb(200, 200, 200)
$lblFooter.Font = New-Object Drawing.Font('Segoe UI', 9)
$footerPanel.Controls.Add($lblFooter)

$lnkRouti = New-Object Windows.Forms.LinkLabel
$lnkRouti.Text = 'https://routicket.com'
$lnkRouti.AutoSize = $true
$lnkRouti.Location = New-Object Drawing.Point(($lblFooter.Right), 12)
$lnkRouti.LinkColor = [Drawing.Color]::FromArgb(80, 170, 255)
$lnkRouti.ActiveLinkColor = [Drawing.Color]::FromArgb(140, 200, 255)
$lnkRouti.Font = New-Object Drawing.Font('Segoe UI', 9, [Drawing.FontStyle]::Bold)
$lnkRouti.Add_LinkClicked({
    try { Start-Process 'https://routicket.com' } catch {}
})
$footerPanel.Controls.Add($lnkRouti)

$lblVersion = New-Object Windows.Forms.Label
$lblVersion.Text = "$BuildVersion · © Routicket"
$lblVersion.AutoSize = $true
$lblVersion.ForeColor = [Drawing.Color]::FromArgb(140, 140, 140)
$lblVersion.Font = New-Object Drawing.Font('Segoe UI', 9)
$lblVersion.Anchor = 'Bottom,Right'
$footerPanel.Controls.Add($lblVersion)
$lblVersion.Location = New-Object Drawing.Point(($footerPanel.Width - $lblVersion.PreferredWidth - 16), 12)
$footerPanel.Add_Resize({
    $lblVersion.Location = New-Object Drawing.Point(($footerPanel.Width - $lblVersion.PreferredWidth - 16), 12)
})

function Append-Log($rtb, $text, $color) {
    $rtb.SelectionStart = $rtb.TextLength
    $rtb.SelectionLength = 0
    $rtb.SelectionColor = $color
    $rtb.AppendText($text + [Environment]::NewLine)
    $rtb.ScrollToCaret()
}

function Colored($level) {
    switch ($level) {
        'success' { return [Drawing.Color]::FromArgb(80, 220, 100) }
        'warn'    { return [Drawing.Color]::FromArgb(255, 200, 0) }
        'error'   { return [Drawing.Color]::FromArgb(255, 90, 90) }
        default   { return [Drawing.Color]::WhiteSmoke }
    }
}

$script:dbConnectedNotified = $false

function Dispatch-Line($line) {
    if ([string]::IsNullOrWhiteSpace($line)) { return }
    try {
        $obj = $line | ConvertFrom-Json -ErrorAction Stop
        $ts = [DateTimeOffset]::FromUnixTimeMilliseconds([int64]$obj.t).LocalDateTime.ToString('HH:mm:ss')
        $prefix = "[$ts] "
        $msg = "$prefix$($obj.message)"
        $color = Colored $obj.level
        switch ($obj.channel) {
            'db'    {
                Append-Log $dbPanel.Rtb  $msg $color
                if (-not $script:dbConnectedNotified -and $obj.level -eq 'success' -and $obj.message -match 'Conexi') {
                    $script:dbConnectedNotified = $true
                    Notify 'dev-service-rtk' 'Conectado a base de datos correctamente, activando recepción de Routicket.'
                }
            }
            'api'   { Append-Log $apiPanel.Rtb $msg $color }
            'error' { Append-Log $errPanel.Rtb $msg ([Drawing.Color]::FromArgb(255, 90, 90)) }
            default { Append-Log $apiPanel.Rtb $msg $color }
        }
    } catch {
        Append-Log $errPanel.Rtb "[stdout no-JSON] $line" ([Drawing.Color]::FromArgb(200, 200, 200))
    }
}

function Run-Child([string[]]$argv, [bool]$elevated = $false) {
    $tmpOut = [IO.Path]::GetTempFileName()
    $tmpErr = [IO.Path]::GetTempFileName()
    try {
        $spArgs = @{
            FilePath = $ExePath
            ArgumentList = $argv
            Wait = $true
            PassThru = $true
            RedirectStandardOutput = $tmpOut
            RedirectStandardError = $tmpErr
        }
        if ($elevated) {
            $spArgs['Verb'] = 'RunAs'
            $spArgs.Remove('RedirectStandardOutput') | Out-Null
            $spArgs.Remove('RedirectStandardError')  | Out-Null
        } else {
            $spArgs['NoNewWindow'] = $true
        }
        $proc = Start-Process @spArgs
        $stdout = if (Test-Path $tmpOut) { Get-Content -Raw -Encoding UTF8 $tmpOut } else { '' }
        $stderr = if (Test-Path $tmpErr) { Get-Content -Raw -Encoding UTF8 $tmpErr } else { '' }
        return @{ ExitCode = $proc.ExitCode; StdOut = $stdout; StdErr = $stderr }
    } finally {
        Remove-Item -ErrorAction SilentlyContinue $tmpOut, $tmpErr
    }
}

function Build-Diff-Text($diff) {
    $sb = New-Object System.Text.StringBuilder
    foreach ($d in $diff) {
        if ($d.matches) {
            [void]$sb.AppendLine("  [OK]   $($d.key) = $($d.current)")
        } else {
            $cur = if ($null -eq $d.current -or $d.current -eq '') { '(no definido / comentado)' } else { $d.current }
            [void]$sb.AppendLine("  [DIFF] $($d.key)")
            [void]$sb.AppendLine("           actual : $cur")
            [void]$sb.AppendLine("           debería: $($d.target)")
        }
    }
    return $sb.ToString()
}

function Verify-FirebirdConf {
    Append-Log $dbPanel.Rtb "--- Verificando firebird.conf ---" ([Drawing.Color]::Gray)
    $res = Run-Child @('--conf-check') $false
    $json = $null
    try { $json = $res.StdOut | ConvertFrom-Json } catch {}
    if ($null -eq $json) {
        Append-Log $errPanel.Rtb "No se pudo parsear la respuesta de --conf-check: $($res.StdOut)$($res.StdErr)" ([Drawing.Color]::FromArgb(255, 90, 90))
        return
    }

    if (-not $json.found) {
        $msg = "No se encontró firebird.conf en las rutas conocidas:$nl$nl" + ($json.searchedPaths -join "$nl") + "$nl$nl¿Quieres seleccionarlo manualmente?"
        $r = [Windows.Forms.MessageBox]::Show($msg, 'firebird.conf no encontrado', 'YesNo', 'Question')
        if ($r -ne 'Yes') { return }
        $dlg = New-Object Windows.Forms.OpenFileDialog
        $dlg.Filter = 'firebird.conf|firebird.conf|All files (*.*)|*.*'
        $dlg.Title = 'Selecciona firebird.conf'
        if ($dlg.ShowDialog() -ne 'OK') { return }
        $res = Run-Child @('--conf-check','--path',$dlg.FileName) $false
        try { $json = $res.StdOut | ConvertFrom-Json } catch { $json = $null }
        if ($null -eq $json -or -not $json.found) {
            Append-Log $errPanel.Rtb "El archivo seleccionado no parece válido: $($res.StdOut)" ([Drawing.Color]::FromArgb(255, 90, 90))
            return
        }
    }

    Append-Log $dbPanel.Rtb "Archivo: $($json.path)" ([Drawing.Color]::WhiteSmoke)
    Append-Log $dbPanel.Rtb (Build-Diff-Text $json.diff) ([Drawing.Color]::WhiteSmoke)

    if (-not $json.needsUpdate) {
        Append-Log $dbPanel.Rtb "firebird.conf ya tiene la configuración requerida. Nada que cambiar." ([Drawing.Color]::FromArgb(80, 220, 100))
        [Windows.Forms.MessageBox]::Show("Todo en orden: firebird.conf ya tiene la configuración requerida.$nl$nl$($json.path)", 'firebird.conf OK', 'OK', 'Information') | Out-Null
        return
    }

    $diffText = Build-Diff-Text $json.diff
    $confirm = "Se aplicarán los siguientes cambios en:$nl$($json.path)$nl$nl$diffText$nlSe creará un respaldo .bak-<timestamp> junto al archivo.$nl$nl¿Aplicar los cambios?"
    $r = [Windows.Forms.MessageBox]::Show($confirm, 'Ajustar firebird.conf', 'YesNo', 'Question')
    if ($r -ne 'Yes') {
        Append-Log $dbPanel.Rtb "El usuario canceló el ajuste." ([Drawing.Color]::FromArgb(255, 200, 0))
        return
    }

    Append-Log $dbPanel.Rtb "Aplicando cambios..." ([Drawing.Color]::Gray)
    $applyArgs = @('--conf-apply','--path',$json.path)
    $apply = Run-Child $applyArgs $false
    $applyJson = $null
    try { $applyJson = $apply.StdOut | ConvertFrom-Json } catch {}

    if ($apply.ExitCode -ne 0 -or ($applyJson -and -not $applyJson.ok)) {
        $code = if ($applyJson) { $applyJson.code } else { '' }
        if ($code -eq 'EACCES' -or $code -eq 'EPERM' -or $apply.StdErr -match 'access' -or $apply.StdErr -match 'denied') {
            $r2 = [Windows.Forms.MessageBox]::Show("Se necesitan permisos de administrador para escribir en $($json.path).$nl$nl¿Reintentar con elevación (UAC)?", 'Permisos', 'YesNo', 'Warning')
            if ($r2 -eq 'Yes') {
                $apply2 = Run-Child $applyArgs $true
                if ($apply2.ExitCode -eq 0) {
                    Append-Log $dbPanel.Rtb "Cambios aplicados con éxito (elevado). Reinicia el servicio de Firebird para que tomen efecto." ([Drawing.Color]::FromArgb(80, 220, 100))
                    [Windows.Forms.MessageBox]::Show("firebird.conf actualizado.$nl$nlReinicia el servicio de Firebird (services.msc → 'Firebird Server ...' → Restart) para que los cambios tomen efecto.", 'Listo', 'OK', 'Information') | Out-Null
                } else {
                    Append-Log $errPanel.Rtb "Falló incluso con elevación. Exit=$($apply2.ExitCode)" ([Drawing.Color]::FromArgb(255, 90, 90))
                }
                return
            }
        }
        Append-Log $errPanel.Rtb "Falló el apply: $($apply.StdOut)$($apply.StdErr)" ([Drawing.Color]::FromArgb(255, 90, 90))
        return
    }

    Append-Log $dbPanel.Rtb "Cambios aplicados. Backup: $($applyJson.backupPath)" ([Drawing.Color]::FromArgb(80, 220, 100))
    foreach ($c in $applyJson.changes) {
        $from = if ($null -eq $c.from -or $c.from -eq '') { '(no definido)' } else { $c.from }
        Append-Log $dbPanel.Rtb "  $($c.key): $from -> $($c.to)" ([Drawing.Color]::WhiteSmoke)
    }
    [Windows.Forms.MessageBox]::Show("firebird.conf actualizado.$nl$nlReinicia el servicio de Firebird (services.msc → 'Firebird Server ...' → Restart) para que los cambios tomen efecto.", 'Listo', 'OK', 'Information') | Out-Null
}

$btnConf.Add_Click({
    $btnConf.Enabled = $false
    try {
        Verify-FirebirdConf
    } finally {
        $btnConf.Enabled = $true
    }
})

# ----- Botones de prueba por pasos -----
$btnSelDb.Add_Click({
    $dlg = New-Object Windows.Forms.OpenFileDialog
    $dlg.Filter = 'Firebird DB (*.fdb;*.FDB)|*.fdb;*.FDB|All files (*.*)|*.*'
    $dlg.Title = 'Selecciona el archivo .fdb (server-side)'
    if ($dlg.ShowDialog() -eq 'OK') {
        $tbDb.Text = $dlg.FileName
        Append-Log $dbPanel.Rtb "BD seleccionada: $($dlg.FileName)" ([Drawing.Color]::WhiteSmoke)
        [void](Save-Config)
    }
})

function Run-Test([string]$flag, [string]$label) {
    Append-Log $dbPanel.Rtb "--- $label ---" ([Drawing.Color]::Gray)
    [void](Save-Config)
    $res = Run-Child @($flag) $false
    $json = $null
    try { $json = $res.StdOut | ConvertFrom-Json -ErrorAction Stop } catch {}
    if ($null -eq $json) {
        Append-Log $errPanel.Rtb "$label: respuesta no-JSON. stdout=$($res.StdOut)  stderr=$($res.StdErr)" ([Drawing.Color]::FromArgb(255, 90, 90))
        return $null
    }
    return $json
}

$btnConn.Add_Click({
    $btnConn.Enabled = $false
    try {
        $r = Run-Test '--test-conn' 'Probar conexión Firebird'
        if ($null -eq $r) { return }
        if ($r.ok) {
            Append-Log $dbPanel.Rtb "✓ Conexión OK con $($r.user)@$($r.host):$($r.port) → $($r.database)" ([Drawing.Color]::FromArgb(80, 220, 100))
        } else {
            Append-Log $errPanel.Rtb "✗ Conexión falló: $($r.error) [code=$($r.code)]" ([Drawing.Color]::FromArgb(255, 90, 90))
            Append-Log $errPanel.Rtb "  host=$($r.host) puerto=$($r.port) user=$($r.user)" ([Drawing.Color]::FromArgb(200, 200, 200))
        }
    } finally { $btnConn.Enabled = $true }
})

$btnData.Add_Click({
    $btnData.Enabled = $false
    try {
        $r = Run-Test '--test-data' 'Probar acceso a datos (VENTATICKETS)'
        if ($null -eq $r) { return }
        if ($r.ok) {
            Append-Log $dbPanel.Rtb "✓ Acceso OK · tickets cerrados no cancelados: $($r.totalTickets) · últimos IDs: $($r.sampleIds -join ', ') · lastSentId: $($r.lastSentId)" ([Drawing.Color]::FromArgb(80, 220, 100))
        } else {
            Append-Log $errPanel.Rtb "✗ Acceso datos falló: $($r.error) [code=$($r.code)]" ([Drawing.Color]::FromArgb(255, 90, 90))
        }
    } finally { $btnData.Enabled = $true }
})

$btnRouti.Add_Click({
    $btnRouti.Enabled = $false
    try {
        $r = Run-Test '--test-routicket' 'Probar Routicket (sale TEST-<ts>)'
        if ($null -eq $r) { return }
        Append-Log $apiPanel.Rtb "→ payload: $($r.sentPayload | ConvertTo-Json -Depth 5 -Compress)" ([Drawing.Color]::WhiteSmoke)
        if ($r.ok) {
            Append-Log $apiPanel.Rtb "✓ Routicket OK · HTTP $($r.httpStatus) $($r.httpStatusText) · body: $($r.body | ConvertTo-Json -Depth 5 -Compress)" ([Drawing.Color]::FromArgb(80, 220, 100))
        } else {
            Append-Log $errPanel.Rtb "✗ Routicket falló · HTTP $($r.httpStatus) $($r.httpStatusText) · error: $($r.error) · body: $($r.body | ConvertTo-Json -Depth 5 -Compress)" ([Drawing.Color]::FromArgb(255, 90, 90))
        }
    } finally { $btnRouti.Enabled = $true }
})

$btnUninst.Add_Click({
    $r = [Windows.Forms.MessageBox]::Show(
        "Esto va a:$nl  • Cerrar la ventana$nl  • Detener la recepción si está activa$nl  • Borrar el .exe + config + log + sent-state$nl$nl¿Continuar?",
        'Desinstalar dev-service-rtk',
        'YesNo', 'Warning')
    if ($r -ne 'Yes') { return }
    if ($null -ne $script:watchProc) {
        try { Stop-Process -Id $script:watchProc.Id -Force -ErrorAction SilentlyContinue } catch {}
        $script:watchProc = $null
    }
    $res = Run-Child @('--uninstall') $false
    Append-Log $apiPanel.Rtb "Desinstalación programada: $($res.StdOut)" ([Drawing.Color]::FromArgb(255, 200, 0))
    Notify 'dev-service-rtk' 'Desinstalación en curso. La ventana se cerrará en breve.'
    Start-Sleep -Milliseconds 600
    $form.Close()
})

# ----- Estado de recepción -----
$script:watchProc = $null
$script:watchEvents = @()

function Set-Active($active) {
    if ($active) {
        $btnToggle.Text = 'Desactivar recepción'
        $btnToggle.BackColor = [Drawing.Color]::FromArgb(200, 60, 60)
        $lblStatus.Text = 'Estado: recepción activa (polling cada 10s)'
        $lblStatus.ForeColor = [Drawing.Color]::FromArgb(80, 220, 100)
    } else {
        $btnToggle.Text = '5. Activar recepción'
        $btnToggle.BackColor = [Drawing.Color]::FromArgb(40, 140, 60)
        $lblStatus.Text = 'Estado: inactivo  ·  flujo sugerido: 1 → 2 → 3 → 4 → 5'
        $lblStatus.ForeColor = [Drawing.Color]::FromArgb(200, 200, 200)
    }
    $btnToggle.Enabled = $true
}

function Save-Config {
    $portInt = 3050
    [int]::TryParse($tbPort.Text, [ref]$portInt) | Out-Null
    $newCfg = [ordered]@{
        firebird = [ordered]@{
            host     = $tbHost.Text
            port     = $portInt
            database = $tbDb.Text
            user     = $tbUser.Text
            password = $tbPwd.Text
        }
        api = [ordered]@{
            endpoint = $tbEp.Text
        }
    }
    try {
        $newCfg | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 -Path $ConfigPath
        Append-Log $dbPanel.Rtb "Configuración guardada en $ConfigPath" ([Drawing.Color]::Gray)
        return $true
    } catch {
        Append-Log $errPanel.Rtb "No se pudo guardar la config: $_" ([Drawing.Color]::FromArgb(255, 90, 90))
        return $false
    }
}

function Start-Watch {
    $btnToggle.Enabled = $false
    $dbPanel.Rtb.Clear(); $apiPanel.Rtb.Clear(); $errPanel.Rtb.Clear()
    $script:dbConnectedNotified = $false
    [void](Save-Config)

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $ExePath
    $psi.Arguments = '--watch'
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError  = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $psi.StandardErrorEncoding  = [System.Text.Encoding]::UTF8

    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi
    $proc.EnableRaisingEvents = $true

    $stdoutEv = Register-ObjectEvent -InputObject $proc -EventName 'OutputDataReceived' -Action {
        if ($null -ne $EventArgs.Data) {
            $form.BeginInvoke([Action]{ Dispatch-Line $EventArgs.Data }) | Out-Null
        }
    }
    $stderrEv = Register-ObjectEvent -InputObject $proc -EventName 'ErrorDataReceived' -Action {
        if ($null -ne $EventArgs.Data) {
            $form.BeginInvoke([Action]{ Append-Log $errPanel.Rtb "[stderr] $($EventArgs.Data)" ([Drawing.Color]::FromArgb(255, 150, 80)) }) | Out-Null
        }
    }
    $exitEv = Register-ObjectEvent -InputObject $proc -EventName 'Exited' -Action {
        $form.BeginInvoke([Action]{
            $code = $script:watchProc.ExitCode
            $msg = "Recepción detenida (exit=$code)."
            $col = if ($code -eq 0) { [Drawing.Color]::FromArgb(80, 220, 100) } else { [Drawing.Color]::FromArgb(255, 90, 90) }
            Append-Log $apiPanel.Rtb $msg $col
            $script:watchProc = $null
            Set-Active $false
        }) | Out-Null
    }
    $script:watchEvents = @($stdoutEv, $stderrEv, $exitEv)

    try {
        $proc.Start() | Out-Null
        $proc.BeginOutputReadLine()
        $proc.BeginErrorReadLine()
        $script:watchProc = $proc
        Set-Active $true
        Notify 'dev-service-rtk' 'Recepción de Routicket activada. Polling cada 10 segundos.'
    } catch {
        Append-Log $errPanel.Rtb "No se pudo arrancar $ExePath : $_" ([Drawing.Color]::FromArgb(255, 90, 90))
        Set-Active $false
    }
}

function Stop-Watch {
    $btnToggle.Enabled = $false
    $proc = $script:watchProc
    if ($null -eq $proc) {
        Set-Active $false
        return
    }
    try {
        if (-not $proc.HasExited) {
            # Intento limpio: cerrar stdin para que Node note EOF y, si no, kill tree.
            try { $proc.CloseMainWindow() | Out-Null } catch {}
            Start-Sleep -Milliseconds 300
            if (-not $proc.HasExited) {
                try { Stop-Process -Id $proc.Id -Force -ErrorAction Stop } catch {}
            }
        }
    } catch {
        Append-Log $errPanel.Rtb "Error deteniendo recepción: $_" ([Drawing.Color]::FromArgb(255, 90, 90))
    }
    Notify 'dev-service-rtk' 'Recepción de Routicket desactivada.'
    Append-Log $apiPanel.Rtb 'Solicitada la desactivación de la recepción.' ([Drawing.Color]::FromArgb(255, 200, 0))
}

$btnToggle.Add_Click({
    if ($null -eq $script:watchProc) {
        Start-Watch
    } else {
        Stop-Watch
    }
})

$form.Add_FormClosing({
    if ($null -ne $script:watchProc) {
        try { Stop-Process -Id $script:watchProc.Id -Force -ErrorAction SilentlyContinue } catch {}
    }
    foreach ($ev in $script:watchEvents) {
        try { Unregister-Event -SourceIdentifier $ev.Name -ErrorAction SilentlyContinue } catch {}
    }
    if ($null -ne $script:trayIcon) {
        try { $script:trayIcon.Visible = $false; $script:trayIcon.Dispose() } catch {}
    }
})

[void]$form.ShowDialog()
`;

function detectExePath(): string {
    const isPkg = typeof (process as unknown as { pkg?: unknown }).pkg !== 'undefined';
    if (isPkg) return process.execPath;
    return process.execPath; // node binary
}

function logStartup(baseDir: string, line: string): void {
    try { fs.appendFileSync(path.join(baseDir, 'dev-service-rtk-startup.log'), `[${new Date().toISOString()}] [gui] ${line}\n`); } catch { /* ignore */ }
}

function findPowerShell(baseDir: string): string {
    const sysRoot = process.env.SystemRoot || 'C:\\Windows';
    const candidates = [
        path.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        path.join(sysRoot, 'SysWOW64', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        'powershell.exe',
    ];
    for (const c of candidates) {
        if (c.includes('\\') && fs.existsSync(c)) {
            logStartup(baseDir, `powershell encontrado en: ${c}`);
            return c;
        }
    }
    logStartup(baseDir, `powershell absoluto no encontrado, fallback a PATH 'powershell.exe'`);
    return 'powershell.exe';
}

export function launchGui(): number {
    const baseDir = path.dirname(process.execPath);
    if (process.platform !== 'win32') {
        console.error('La GUI solo está disponible en Windows.');
        console.error('En Linux/macOS usa: dev-service-rtk --sync  (o npm run sync).');
        return 1;
    }

    const tmpFile = path.join(os.tmpdir(), `dev-service-rtk-gui-${Date.now()}.ps1`);
    try {
        fs.writeFileSync(tmpFile, '﻿' + POWERSHELL_GUI, { encoding: 'utf8' });
        logStartup(baseDir, `tmp ps1 escrito (${POWERSHELL_GUI.length} chars + BOM): ${tmpFile}`);
    } catch (e) {
        logStartup(baseDir, `ERROR escribiendo tmp ps1: ${e instanceof Error ? e.stack : String(e)}`);
        return 2;
    }

    const configPath = path.join(baseDir, 'dev-service-rtk.config.json');
    const exePath = detectExePath();
    const powershellPath = findPowerShell(baseDir);

    try {
        logStartup(baseDir, `spawn ${powershellPath} -ExePath=${exePath} -ConfigPath=${configPath}`);
        const res = spawnSync(powershellPath, [
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-File', tmpFile,
            '-ExePath', exePath,
            '-ConfigPath', configPath,
        ], { stdio: 'inherit' });
        if (res.error) {
            logStartup(baseDir, `ERROR spawnSync: ${res.error.message}`);
            return 3;
        }
        logStartup(baseDir, `powershell exit=${res.status} signal=${res.signal}`);
        return res.status ?? 0;
    } finally {
        try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
}
