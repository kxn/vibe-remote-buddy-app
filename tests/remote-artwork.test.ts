import {it,expect} from "vitest";
import {renderRemoteArtwork} from "../src/core/remote-artwork";
import {validateModel} from "../src/core/models";
import model from "../resources/remotes/xiaomi.rc003/model.json";
it("generates deterministic standalone SVG with escaped custom labels",()=>{
 const m=validateModel(structuredClone(model));
 m.layout.buttons[0].symbol='<&"';
 const svg=renderRemoteArtwork(m);
 expect(svg).toBe(renderRemoteArtwork(m));
 expect(svg).toContain('viewBox="0 0 '+m.layout.width+' '+m.layout.height+'"');
 expect(svg).toContain('&lt;&amp;&quot;');
 expect(svg).not.toMatch(/<script|href=|<foreignObject/);
 expect(svg.match(/<rect /g)!.length).toBeGreaterThan(m.keys.length);
});
