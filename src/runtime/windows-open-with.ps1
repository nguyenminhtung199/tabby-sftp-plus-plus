param([string]$Target, [uint32]$Flags, [int]$CancelExitCode, [switch]$CompileOnly)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class SftpOpenWith {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public struct OpenAsInfo {
        [MarshalAs(UnmanagedType.LPWStr)] public string File;
        [MarshalAs(UnmanagedType.LPWStr)] public string Class;
        public uint Flags;
    }
    [DllImport("shell32.dll", CharSet=CharSet.Unicode, PreserveSig=true)]
    public static extern int SHOpenWithDialog(IntPtr parent, ref OpenAsInfo info);
}
"@
if ($CompileOnly) { exit 0 }
if (-not (Test-Path -LiteralPath $Target -PathType Leaf)) { throw 'Open with target is unavailable' }
$info = New-Object SftpOpenWith+OpenAsInfo
$info.File = $Target
$info.Class = $null
$info.Flags = $Flags
$result = [SftpOpenWith]::SHOpenWithDialog([IntPtr]::Zero, [ref]$info)
if ($result -eq -2147023673) { exit $CancelExitCode }
if ($result -lt 0) { throw ('Open with failed: 0x{0:X8}' -f $result) }
exit 0
