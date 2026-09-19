"""No hardware: reject unsafe packages and device identities before any erase."""
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch, MagicMock
import sys
from types import SimpleNamespace

root=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('helper',root/'tools/receiver_setup/helper.py')
helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)

class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.folder=Path(self.tmp.name)
        files=[]
        for off,(name,_) in helper.EXPECTED.items():
            b=bytearray(300);b[0]=0xe9;struct.pack_into('<H',b,12,9)
            if name=='receiver.bin':
                struct.pack_into('<I',b,32,0xabcd5432);b[48:53]=b'0.8.0';b[80:92]=b'buddy_s3_ab1'
            (self.folder/name).write_bytes(b)
            files.append(dict(offset=off,name=name,size=len(b),sha256=hashlib.sha256(b).hexdigest()))
        self.manifest=dict(format=1,target='s3-16m-8m-ab1',version='0.8.0',files=files)
        self.save()
    def tearDown(self):self.tmp.cleanup()
    def save(self):(self.folder/'install.json').write_text(json.dumps(self.manifest))
    def esp(self,cap=1,chip='ESP32-S3',protected=False):
        e=MagicMock(CHIP_NAME=chip,secure_download_mode=False)
        e.get_secure_boot_enabled.return_value=protected;e.get_flash_encryption_enabled.return_value=False
        e.flash_id.return_value=0x1840ef;e.get_psram_cap.return_value=cap
        e.read_mac.return_value=bytes.fromhex('112233445566');e.get_chip_description.return_value=chip
        return e
    def test_valid(self):self.assertEqual(len(helper.load_package(self.folder)[1]),4)
    def test_missing_or_duplicate(self):
        self.manifest['files'][1]=self.manifest['files'][0];self.save()
        with self.assertRaises(ValueError):helper.load_package(self.folder)
    def test_traversal(self):
        self.manifest['files'][0]['name']='../other.bin';self.save()
        with self.assertRaises(ValueError):helper.load_package(self.folder)
    def test_corrupt(self):
        (self.folder/'receiver.bin').write_bytes(b'bad')
        with self.assertRaises(ValueError):helper.load_package(self.folder)
    def test_wrong_version(self):
        self.manifest['version']='9.0.0';self.save()
        with self.assertRaises(ValueError):helper.load_package(self.folder)
    def test_hardware_gates(self):
        for e in [self.esp(chip='ESP32-C6'),self.esp(protected=True),self.esp(cap=2)]:
            with self.assertRaises(ValueError):helper.inspect(e)
            e.erase_flash.assert_not_called()
        self.assertFalse(helper.inspect(self.esp(cap=0))['psram_known'])
    def test_no_erase_on_wrong_identity_or_missing_confirmation(self):
        for mac in ['BAD','112233445566']:
            e=self.esp(cap=0);cmds=MagicMock();cmds.detect_chip.return_value=e
            fake=SimpleNamespace(cmds=cmds)
            with patch.dict(sys.modules,{'esptool':fake}),patch.object(sys,'argv',['helper','install','--package',str(self.folder),'--port','TEST','--expected-mac',mac]):
                with self.assertRaises(ValueError):helper.main()
            cmds.write_flash.assert_not_called();e.run_stub.assert_not_called()
    def test_rejected_check_restores_original_program(self):
        e=self.esp(cap=2);cmds=MagicMock();cmds.detect_chip.return_value=e
        with patch.dict(sys.modules,{'esptool':SimpleNamespace(cmds=cmds)}),patch.object(sys,'argv',['helper','check','--package',str(self.folder),'--port','TEST']):
            with self.assertRaisesRegex(ValueError,'2 MB'):helper.main()
        e.hard_reset.assert_called_once();e._port.close.assert_called_once()
        cmds.write_flash.assert_not_called();e.run_stub.assert_not_called()
    def test_install_verifies_and_disables_reconnect(self):
        e=self.esp(cap=0);stub=MagicMock();e.run_stub.return_value=stub;cmds=MagicMock();cmds.detect_chip.return_value=e
        with patch.dict(sys.modules,{'esptool':SimpleNamespace(cmds=cmds)}),patch.object(sys,'argv',['helper','install','--package',str(self.folder),'--port','TEST','--expected-mac','112233445566','--confirm-board']):helper.main()
        self.assertEqual(stub.WRITE_FLASH_ATTEMPTS,1)
        self.assertFalse(cmds.write_flash.call_args.args[1].force)
        self.assertTrue(cmds.write_flash.call_args.args[1].erase_all)
        cmds.verify_flash.assert_called_once();stub.hard_reset.assert_called_once()

if __name__=='__main__':unittest.main()
