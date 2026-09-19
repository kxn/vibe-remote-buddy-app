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
        self.variant='o8'
        self.package=self.folder/'o8';self.package.mkdir()
        files=[]
        for off,(name,_) in helper.EXPECTED.items():
            b=bytearray(300);b[0]=0xe9;b[3]=0x30;struct.pack_into('<H',b,12,9)
            if name=='receiver.bin':
                struct.pack_into('<I',b,32,0xabcd5432);b[48:53]=b'0.8.0';b[80:94]=b'buddy_s3_o8_ab1'
            (self.package/name).write_bytes(b)
            files.append(dict(offset=off,name=name,size=len(b),sha256=hashlib.sha256(b).hexdigest()))
        self.manifest=dict(format=1,target='s3-o8-ab1',version='0.8.0',files=files)
        self.save()
        import shutil
        shutil.copytree(self.package,self.folder/'q2')
        q=self.folder/'q2';b=bytearray((q/'receiver.bin').read_bytes());b[80:112]=bytes(32);b[80:94]=b'buddy_s3_q2_ab1';(q/'receiver.bin').write_bytes(b)
        m=json.loads(json.dumps(self.manifest));m['target']='s3-q2-ab1'
        for e in m['files']:
            data=(q/e['name']).read_bytes();e.update(size=len(data),sha256=hashlib.sha256(data).hexdigest())
        (q/'install.json').write_text(json.dumps(m))
        (self.folder/'catalog.json').write_text(json.dumps(dict(format=1,variants=['q2','o8'])))
    def tearDown(self):self.tmp.cleanup()
    def save(self):(self.package/'install.json').write_text(json.dumps(self.manifest))
    def esp(self,cap=1,chip='ESP32-S3',protected=False):
        e=MagicMock(CHIP_NAME=chip,secure_download_mode=False)
        e.get_secure_boot_enabled.return_value=protected;e.get_flash_encryption_enabled.return_value=False
        e.flash_type.return_value=0;e.flash_id.return_value=0x1840ef;e.get_psram_cap.return_value=cap
        e.read_mac.return_value=bytes.fromhex('112233445566');e.get_chip_description.return_value=chip
        return e
    def test_valid(self):self.assertEqual(len(helper.load_package(self.package)[1]),4)
    def test_missing_or_duplicate(self):
        self.manifest['files'][1]=self.manifest['files'][0];self.save()
        with self.assertRaises(ValueError):helper.load_package(self.package)
    def test_traversal(self):
        self.manifest['files'][0]['name']='../other.bin';self.save()
        with self.assertRaises(ValueError):helper.load_package(self.package)
    def test_corrupt(self):
        (self.package/'receiver.bin').write_bytes(b'bad')
        with self.assertRaises(ValueError):helper.load_package(self.package)
    def test_wrong_version(self):
        self.manifest['version']='9.0.0';self.save()
        with self.assertRaises(ValueError):helper.load_package(self.package)
    def test_hardware_gates(self):
        for e in [self.esp(chip='ESP32-C6'),self.esp(protected=True),self.esp(cap=3)]:
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
        e=self.esp(cap=3);cmds=MagicMock();cmds.detect_chip.return_value=e
        with patch.dict(sys.modules,{'esptool':SimpleNamespace(cmds=cmds)}),patch.object(sys,'argv',['helper','check','--package',str(self.folder),'--port','TEST']):
            with self.assertRaisesRegex(ValueError,'16 MB'):helper.main()
        e.hard_reset.assert_called_once();e._port.close.assert_called_once()
        cmds.write_flash.assert_not_called();e.run_stub.assert_not_called()
    def test_quad_and_octal_detection_and_flash_sizes(self):
        for cap,variant in [(1,'o8'),(2,'q2')]:
            for size in (23,24):
                e=self.esp(cap=cap);e.flash_id.return_value=(size<<16)|0x40ef
                i=helper.inspect(e);self.assertEqual(i['variant'],variant);self.assertEqual(i['flash_bytes'],1<<size)
        e=self.esp();e.flash_type.return_value=1
        with self.assertRaisesRegex(ValueError,'Octal Flash'):helper.inspect(e)
        e=self.esp();e.flash_id.return_value=0x1640ef
        with self.assertRaisesRegex(ValueError,'Flash'):helper.inspect(e)
    def test_wrong_variant_never_erases(self):
        e=self.esp(cap=2);cmds=MagicMock();cmds.detect_chip.return_value=e
        with patch.dict(sys.modules,{'esptool':SimpleNamespace(cmds=cmds)}),patch.object(sys,'argv',['helper','install','--package',str(self.folder),'--port','TEST','--expected-mac','112233445566','--variant','o8']):
            with self.assertRaisesRegex(ValueError,'不匹配'):helper.main()
        cmds.write_flash.assert_not_called();e.run_stub.assert_not_called()
    def test_install_verifies_and_disables_reconnect(self):
        e=self.esp(cap=0);stub=MagicMock();e.run_stub.return_value=stub;cmds=MagicMock();cmds.detect_chip.return_value=e
        with patch.dict(sys.modules,{'esptool':SimpleNamespace(cmds=cmds)}),patch.object(sys,'argv',['helper','install','--package',str(self.folder),'--port','TEST','--expected-mac','112233445566','--confirm-board','--variant','o8']):helper.main()
        self.assertEqual(stub.WRITE_FLASH_ATTEMPTS,1)
        self.assertFalse(cmds.write_flash.call_args.args[1].force)
        self.assertTrue(cmds.write_flash.call_args.args[1].erase_all)
        cmds.verify_flash.assert_called_once();stub.hard_reset.assert_called_once()

if __name__=='__main__':unittest.main()
