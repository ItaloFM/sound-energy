$(document).ready(function () {

    // Se já está logado, vai direto para o index
    if (localStorage.getItem("se_usuario")) {
        window.location.href = "../index.html";
        return;
    }

    $("#login-id").on("click", function () {
        const usuario = $("#nome-id").val().trim();
        const senha   = $("#senha-id").val().trim();

        if (usuario === "") {
            Swal.fire({
                icon: "error",
                title: "Usuário inválido",
                text: "Preencha o campo Usuário!",
                timer: 2000,
                showConfirmButton: false,
                background: "#1a1a1a",
                color: "#fff"
            });
            return;
        }

        if (senha === "" || senha.length < 6) {
            Swal.fire({
                icon: "error",
                title: "Senha inválida",
                text: "A senha precisa ter no mínimo 6 caracteres!",
                timer: 2000,
                showConfirmButton: false,
                background: "#1a1a1a",
                color: "#fff"
            });
            return;
        }

        // Salva o usuário no localStorage
        localStorage.setItem("se_usuario", usuario);

        Swal.fire({
            icon: "success",
            title: "Bem-vindo, " + usuario + "!",
            showConfirmButton: false,
            timer: 1500,
            background: "#1a1a1a",
            color: "#fff"
        });

        setTimeout(function () {
            window.location.href = "../index.html";
        }, 1500);
    });

    // Enter no campo de senha também faz login
    $("#senha-id").on("keydown", function (e) {
        if (e.key === "Enter") $("#login-id").trigger("click");
    });

});
