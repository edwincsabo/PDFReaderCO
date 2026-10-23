export function originalDiagnostic(run){
  const reason=run.editable?(run.movable?'':run.moveReason):run.reason;
  if(!reason)return{title:'Texto compatible',reason:'Puedes moverlo o editar su contenido.',suggestion:run.embedded?'Si faltan caracteres, elige una fuente alternativa en Propiedades.':'Revisa la vista previa antes de aplicar cambios.'};
  let suggestion='Prueba Fragmentos individuales para comprobar si hay una parte compatible. El contenido original se conserva.';
  if(/invisible|oculto/i.test(reason))suggestion='Este texto no se pinta en la página. Si procede de OCR, sirve para buscar y copiar; editarlo no cambia las letras de la imagen.';
  else if(/fuente|Unicode|caracter/i.test(reason))suggestion='Si puedes abrir el editor, elige una fuente alternativa en Propiedades. Si no se recupera texto legible, conserva el original y añade una anotación.';
  else if(/máscara|recorte|contorno|pintado|transformación/i.test(reason))suggestion=run.editable?'Puedes editar el contenido sin moverlo. Revisa la vista previa para comprobar qué parte deja visible la máscara.':'La geometría o el modo de pintado impiden una modificación fiable. Prueba Fragmentos individuales; si sigue bloqueado, añade una anotación.';
  else if(/grupo|profundidad|apariciones|memoria/i.test(reason))suggestion='Prueba otra selección compatible. Este grupo se conserva para evitar alterar otras apariciones del contenido.';
  return{title:run.editable?'Edición disponible · movimiento limitado':'Selección conservada sin editar',reason,suggestion};
}
