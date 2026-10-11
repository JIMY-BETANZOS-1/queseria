import uuid
from datetime import date, timedelta

from conftest import cab, crear_acopiador


def test_crud_completo_de_rutas(client, admin, db):
    h = cab(admin)
    nombre = f"Ruta prueba {uuid.uuid4().hex[:6]}"

    # Crear
    r = client.post("/rutas", json={"nombre": nombre, "descripcion": "EJEMPLO"}, headers=h)
    assert r.status_code == 201, r.text
    ruta = r.json()
    assert ruta["activa"] is True and ruta["acopiador_id"] is None

    # Listar y obtener
    assert any(x["id"] == ruta["id"] for x in client.get("/rutas", headers=h).json())
    assert client.get(f"/rutas/{ruta['id']}", headers=h).json()["nombre"] == nombre

    # Editar
    r = client.patch(f"/rutas/{ruta['id']}", json={"descripcion": "Nueva descripción"}, headers=h)
    assert r.status_code == 200 and r.json()["descripcion"] == "Nueva descripción"

    # Asignar acopiador A (desde hoy) y reasignar a B desde mañana
    a, b = crear_acopiador(client, admin), crear_acopiador(client, admin)
    r = client.put(f"/rutas/{ruta['id']}/acopiador", json={"acopiador_id": a["id"]}, headers=h)
    assert r.status_code == 200, r.text
    hoy = date.fromisoformat(r.json()["vigente_desde"])
    assert client.get(f"/rutas/{ruta['id']}", headers=h).json()["acopiador_id"] == a["id"]
    assert client.get(f"/acopiadores/{a['id']}", headers=h).json()["rutas"][0]["ruta_id"] == ruta["id"]

    manana = hoy + timedelta(days=1)
    r = client.put(f"/rutas/{ruta['id']}/acopiador", json={"acopiador_id": b["id"], "desde": manana.isoformat()},
                   headers=h)
    assert r.status_code == 200, r.text

    historial = client.get(f"/rutas/{ruta['id']}/asignaciones", headers=h).json()
    assert [(x["acopiador_id"], x["vigente_desde"], x["vigente_hasta"]) for x in historial] == [
        (b["id"], manana.isoformat(), None),
        (a["id"], hoy.isoformat(), manana.isoformat()),
    ]

    # Una fecha de cambio anterior al inicio de la asignación vigente la rechaza la base
    r = client.put(f"/rutas/{ruta['id']}/acopiador",
                   json={"acopiador_id": a["id"], "desde": (hoy - timedelta(days=10)).isoformat()}, headers=h)
    assert r.status_code == 422
    assert "anterior al inicio" in r.json()["mensaje"]

    # Auditoría: los cambios de ruta_acopiador quedaron a nombre del admin (SET LOCAL app.usuario_id)
    usuarios = db.execute("""
        SELECT DISTINCT usuario_id FROM auditoria
         WHERE tabla = 'ruta_acopiador' AND COALESCE(despues, antes) ->> 'ruta_id' = %s
    """, (str(ruta["id"]),)).fetchall()
    assert [u["usuario_id"] for u in usuarios] == [int(admin["id"])]

    # Quitar acopiador y desactivar la ruta
    r = client.delete(f"/rutas/{ruta['id']}/acopiador", headers=h)
    assert r.status_code == 200 and r.json()["vigente_hasta"] is not None
    assert client.delete(f"/rutas/{ruta['id']}/acopiador", headers=h).status_code == 404

    r = client.patch(f"/rutas/{ruta['id']}", json={"activa": False}, headers=h)
    assert r.json()["activa"] is False and r.json()["acopiador_id"] is None
    assert all(x["id"] != ruta["id"] for x in client.get("/rutas?activa=true", headers=h).json())

    assert client.get("/rutas/999999", headers=h).status_code == 404
