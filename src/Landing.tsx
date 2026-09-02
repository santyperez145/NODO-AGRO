import { Beef, CloudRain, Droplets, Leaf, Map, ScanSearch, ShieldCheck, Tractor, TrendingUp } from 'lucide-react';
import './landing.css';

export function Landing({ onEnter }: { onEnter: (mode: 'login' | 'signup') => void }) {
  return (
    <div className="landing">
      <header className="landNav">
        <a className="landBrand" href="#inicio"><span>⌁</span><b>NODO</b></a>
        <nav>
          <a href="#recorrido">Cómo trabaja</a>
          <a href="#capacidades">Qué incluye</a>
          <a href="#confianza">Confianza</a>
        </nav>
        <div className="landNavActions">
          <button type="button" className="landGhost" onClick={() => onEnter('login')}>Ingresar</button>
          <button type="button" className="landSolid" onClick={() => onEnter('signup')}>Crear cuenta</button>
        </div>
      </header>

      <section className="landHero" id="inicio">
        <div>
          <small>PARA QUIEN LLEVA EL ESTABLECIMIENTO</small>
          <h1>Dejá de decidir con el WhatsApp, el Excel y la memoria.</h1>
          <p>NODO junta el mapa, las recorridas, el agua, la maquinaria, el rodeo y los números en un solo lugar. Cada sugerencia llega con evidencia. Vos aprobás. Nadie opera el campo por vos.</p>
          <div className="landHeroCtas">
            <button type="button" className="landSolid" onClick={() => onEnter('signup')}>Empezar con tu campo</button>
            <a href="#recorrido">Ver cómo se usa</a>
          </div>
          <ul className="landHeroPoints">
            <li>Una escena satelital con fecha, no un color decorativo</li>
            <li>Una recorrida con responsable, foto y cierre</li>
            <li>Una máquina con historial, orden y costo</li>
          </ul>
        </div>
        <aside className="landPreview" aria-hidden="true">
          <div className="landPreviewBar"><span>Vista ilustrativa</span><b>Establecimiento San Martín</b></div>
          <div className="landPreviewMap">
            <i className="p a" /><i className="p b" /><i className="p c" /><i className="pin" />
          </div>
          <div className="landPreviewCards">
            <article><small>Hoy</small><b>Recorrer Lote Bajo</b><span>Señal más baja de la escena</span></article>
            <article><small>Agua</small><b>Referencia a la vista</b><span>Lluvia, riego declarado y evapotranspiración</span></article>
            <article><small>Flota</small><b>Service del 1610</b><span>Orden abierta · responsable asignado</span></article>
          </div>
        </aside>
      </section>

      <section className="landProblem">
        <p>El costo no está en “faltan datos”. Está en que la foto quedó en el celular, el horómetro en un cuaderno y la decisión en un mensaje que nadie vuelve a abrir.</p>
      </section>

      <section className="landPath" id="recorrido">
        <div className="landIntro">
          <small>CÓMO TRABAJA</small>
          <h2>Un circuito que se cierra</h2>
          <p>NODO no te deja con un mapa bonito. Te lleva de la señal a la visita, de la visita a la decisión y de la decisión al registro.</p>
        </div>
        <ol>
          <li><b>01</b><h3>Se ve algo</h3><p>Una fecha satelital, un pronóstico de lluvia o un horómetro vencido. Queda escrito de dónde salió.</p></li>
          <li><b>02</b><h3>Alguien va</h3><p>Se planifica la recorrida, se asigna un responsable y se registra lo que hay en el lote, con foto si hace falta.</p></li>
          <li><b>03</b><h3>Se decide</h3><p>La sugerencia pide tu OK. NODO no pulveriza, no riega y no mueve una máquina.</p></li>
          <li><b>04</b><h3>Queda memoria</h3><p>Costo, responsable y resultado vuelven al historial. La próxima campaña no arranca de cero.</p></li>
        </ol>
      </section>

      <section className="landCaps" id="capacidades">
        <div className="landIntro">
          <small>QUÉ INCLUYE</small>
          <h2>Todo el establecimiento, sin cambiar de herramienta</h2>
          <p>Módulos que se hablan entre sí. El mismo lote, la misma máquina y la misma gente en satélite, campo, agua y economía.</p>
        </div>
        <div className="landGrid">
          <article><Map /><h3>Mapa vivo</h3><p>Imagen satelital fechada y comparación entre lotes. Sirve para priorizar dónde ir, no para diagnosticar una enfermedad.</p></article>
          <article><ScanSearch /><h3>Recorridas</h3><p>Agenda, responsable y evidencia de campo. La foto queda en el establecimiento, no en un chat que se pierde.</p></article>
          <article><Droplets /><h3>Agua</h3><p>Lluvia, riego que ustedes declaran y una referencia clara. No prescribe una lámina ni enciende una bomba.</p></article>
          <article><Tractor /><h3>Maquinaria</h3><p>Inventario, horómetro, service y órdenes de trabajo. Menos “¿quién tocó esto?” en plena ventana de labor.</p></article>
          <article><Beef /><h3>Rodeo</h3><p>Stock que se explica con movimientos: nacimientos, compras, ventas y pesajes. Sin inventar cabezas.</p></article>
          <article><TrendingUp /><h3>Economía</h3><p>Un libro operativo del campo, no un balance contable. Cada gasto o ingreso queda atado a un lote o una máquina.</p></article>
          <article><CloudRain /><h3>Clima del lugar</h3><p>Observación persistida de tu establecimiento. Si falta la red, se ve el último dato válido, no un número inventado.</p></article>
          <article><Leaf /><h3>Cultivos y lotes</h3><p>Polígonos reales, cultivo y superficie. El mapa y las recorridas usan el mismo inventario.</p></article>
        </div>
      </section>

      <section className="landTrust" id="confianza">
        <div>
          <small>CÓMO DECIDIMOS HABLAR</small>
          <h2>Claro con lo que hace, y con lo que no.</h2>
          <p>Hay plataformas que prometen detectar enfermedades, optimizar el riego o subir el rinde. NODO no. Si no se puede mostrar la fuente, no se afirma.</p>
        </div>
        <ul>
          <li><ShieldCheck /><div><b>Tus datos son tuyos</b><span>Cada empresa ve sólo su establecimiento. No se venden lotes ni se mezclan campos ajenos.</span></div></li>
          <li><ShieldCheck /><div><b>Aprobación humana</b><span>Una alerta no es una orden. Intervenciones sensibles quedan para el encargado, el agrónomo o el mecánico.</span></div></li>
          <li><ShieldCheck /><div><b>Sirve con poca señal</b><span>En el lote se puede seguir una recorrida ya abierta. Al volver la red, se sincroniza. No se fabrica el parte.</span></div></li>
        </ul>
      </section>

      <section className="landWho">
        <div className="landIntro">
          <small>PARA QUIÉN ES</small>
          <h2>Campos mixtos que ya no entran en una planilla</h2>
        </div>
        <div className="landWhoGrid">
          <article>
            <h3>Bien si</h3>
            <p>Tienen varios lotes, rodeo y un puñado de máquinas. El encargado decide todos los días y hoy coordina por mensaje. Quieren memoria, no otro tablero abandonado.</p>
          </article>
          <article>
            <h3>Todavía no si</h3>
            <p>Buscan que un sistema riegue solo, diagnostique un animal o reemplace al profesional. Eso no es NODO, y no lo vamos a vender como si lo fuera.</p>
          </article>
        </div>
      </section>

      <section className="landClose">
        <h2>Poné el establecimiento en un solo tablero.</h2>
        <p>Creá la cuenta, cargá el campo y empeza por lo que más te duele: una recorrida, una máquina o el mapa de esta semana.</p>
        <div className="landHeroCtas">
          <button type="button" className="landSolid" onClick={() => onEnter('signup')}>Crear cuenta</button>
          <button type="button" className="landGhost light" onClick={() => onEnter('login')}>Ya tengo acceso</button>
        </div>
      </section>

      <footer className="landFoot">
        <div><span>⌁</span><b>NODO</b></div>
        <p>El sistema operativo verificable del establecimiento. No reemplaza agrónomo, veterinario ni mecánico.</p>
      </footer>
    </div>
  );
}
