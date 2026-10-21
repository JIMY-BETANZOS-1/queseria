"""POST /analista/reportes (foto informativa del analista) y GET /analista/reportes (panel del admin)."""
import uuid

from conftest import cab, crear_productor, crear_ruta_asignada, item_recoleccion, movil_con_celular, push

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPG = b"\xff\xd8\xff\xe0" + b"\x00" * 64


def subir(client, analista, foto=PNG, **campos):
    datos = {"uuid_reporte": str(campos.pop("uuid_reporte", uuid.uuid4())),
             **{k: str(v) for k, v in campos.items()}}
    return client.post("/analista/reportes", data=datos, files={"foto": ("reporte.png", foto, "image/png")},
                       headers=cab(analista["token"]))


def test_reporte_va_a_la_entrega_libre_mas_reciente_sin_tocar_la_calidad(client, admin, db):
    acop = movil_con_celular(client, admin, "acopiador")
    prod = crear_productor(client, admin, crear_ruta_asignada(client, admin, acop["id"]))
    vieja = item_recoleccion(acop, prod["id"], registrada_en="2026-10-01T11:00:00+00:00")
    nueva = item_recoleccion(acop, prod["id"])
    push(client, acop, recolecciones=[vieja, nueva])
    analista = movil_con_celular(client, admin, "analista")

    primero = subir(client, analista, productor_id=prod["id"])
    assert primero.status_code == 200, primero.text
    r1 = primero.json()
    assert r1["estado"] == "creado" and r1["recoleccion_id"] == nueva["id"]
    assert r1["foto_url"].startswith("analisis/reporte-") and r1["foto_url"].endswith(".png")
    fila = db.execute("SELECT estado_calidad::text AS e, calidad_en FROM recoleccion WHERE id = %s", (nueva["id"],)).fetchone()
    assert fila == {"e": "normal", "calidad_en": None}           # informativo: no revisa ni sanciona
    a = db.execute("SELECT ph, temperatura_c, grasa_pct, densidad, antibioticos_positivo FROM analisis_calidad "
                   "WHERE recoleccion_id = %s", (nueva["id"],)).fetchone()
    assert set(a.values()) == {None}
    assert db.execute("SELECT COUNT(*) AS n FROM sancion_productor WHERE productor_id = %s", (prod["id"],)).fetchone()["n"] == 0

    # Reintento del mismo reporte (se perdió la respuesta): no duplica
    otra_vez = subir(client, analista, uuid_reporte=r1["uuid_reporte"], productor_id=prod["id"])
    assert otra_vez.json()["estado"] == "duplicado" and otra_vez.json()["foto_url"] == r1["foto_url"]

    # Un segundo reporte no pisa el primero: va a la entrega libre anterior; sin entregas libres, 409 para reintentar
    segundo = subir(client, analista, foto=JPG, productor_id=prod["id"])
    assert segundo.json()["recoleccion_id"] == vieja["id"] and segundo.json()["foto_url"].endswith(".jpg")
    tercero = subir(client, analista, productor_id=prod["id"])
    assert tercero.status_code == 409 and tercero.json()["codigo"] == "sin_entrega"

    # El admin los ve, con la foto
    lista = client.get("/analista/reportes", headers=cab(admin)).json()
    mios = [x for x in lista if x["productor_id"] == prod["id"]]
    assert [x["recoleccion_id"] for x in mios] == [vieja["id"], nueva["id"]]
    assert mios[0]["productor"] == prod["nombre"] and mios[0]["ruta"] is not None
    foto = client.get(f"/analisis/{nueva['id']}/foto", headers=cab(admin))
    assert foto.status_code == 200 and foto.content == PNG


def test_reporte_de_externo_nuevo_por_uuid_y_sin_entregas(client, admin):
    analista = movil_con_celular(client, admin, "analista")
    sin_alta = subir(client, analista, productor_uuid_cliente=uuid.uuid4())
    assert sin_alta.status_code == 409 and sin_alta.json()["codigo"] == "sin_entrega"
    externo = crear_productor(client, admin)
    sin_entregas = subir(client, analista, productor_id=externo["id"])
    assert sin_entregas.status_code == 409


def test_reporte_validaciones_y_permisos(client, admin):
    analista = movil_con_celular(client, admin, "analista")
    acop = movil_con_celular(client, admin, "acopiador")
    externo = crear_productor(client, admin)
    assert subir(client, analista).status_code == 422                                   # sin productor
    assert subir(client, analista, productor_id=externo["id"], productor_uuid_cliente=uuid.uuid4()).status_code == 422
    assert subir(client, analista, foto=b"no es imagen", productor_id=externo["id"]).status_code == 422
    assert subir(client, acop, productor_id=externo["id"]).status_code == 403
    assert client.get("/analista/reportes", headers=cab(analista["token"])).status_code == 403
