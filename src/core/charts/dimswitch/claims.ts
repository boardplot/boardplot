import type { ClaimRecordV1 } from '../../claims/browser';
import type { Geometry } from '../../types/scene';
import type { DimSwitchDerived } from './types';
import { tableCellNodeId } from '../table/cellKey';

/** Use compiler records; a hidden cell must not claim that its value is drawn. */
export function dimswitchClaims(geometry:Geometry<object,object>):ClaimRecordV1[] {
  const derived=geometry.derived as DimSwitchDerived;
  const rows=new Map(derived.table.rows.map(row=>[row.id,row]));
  const textIds=new Set(geometry.scene.filter(node=>node.t==='text').map(node=>node.id));
  return derived.computedCells.filter(c=>c.op!=='dimswitch:effect' && c.op!=='dimswitch:shapley').map(c=>{
    const row=rows.get(c.rowId);
    const nodeId=row?.inline ? tableCellNodeId('cellline', row.parentId!, c.colId, row.id) : tableCellNodeId('cell', c.rowId, c.colId);
    const op=c.op==='dimswitch:partition-sum' ? 'sum' : c.op==='dimswitch:partition-check'
      ? `sub($0,${c.inputs.slice(1).reduce((sum,_,i)=>`add(${sum},$${i+1})`,'0')})` : c.op;
    return {
      id:`dimswitch:${JSON.stringify([c.rowId,c.colId,c.kind])}`,
      kind:c.raw===null || c.kind==='unaudited' ? 'observed' : c.kind==='calc' ? 'derived' : c.kind==='aggregate' ? 'aggregate' : c.kind==='reconciliation' ? 'reconciliation' : 'rounding',
      op:`${c.raw===null ? 'dimswitch-unavailable' : op}@1`,
      inputs:c.inputs.map(i=>({ref:`${i.rowId}:${i.colId}${i.role ? `#${i.role}` : ''}`,value:i.value,...(i.state ? {state:i.state} : {})})),
      output:{raw:c.raw,state:c.state,displayed:''},
      nodeId:(c.kind==='calc' || c.kind==='aggregate') && textIds.has(nodeId) ? nodeId : undefined,
    };
  });
}
